import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createKeySet, deriveCredentials, generateRecoveryKey } from '../../src/shared/crypto/client';
import { ApiError, apiPost } from '../../src/client/lib/api';
import { changePassword } from '../../src/client/lib/crypto/account';
import { getUnlockedKey, keepKey, setKeyBackend, wipeKeys, wipeKeysInBackground } from '../../src/client/lib/crypto/keyStore';
import type { KeyBackend, StoredKey } from '../../src/client/lib/crypto/keyStore';
import { rememberSharedDevice, setSharedDeviceStorage, sharedDeviceChosen } from '../../src/client/lib/crypto/sharedDevice';
import type { FlagStorage } from '../../src/client/lib/crypto/sharedDevice';
import { unlockWithPassword } from '../../src/client/lib/crypto/unlock';
import {
  AUTH_FAILURE_CLOSE,
  RENEWAL_PATHS,
  SESSION_RENEWED_CLOSE,
  handleSocketClose,
  renewalInProgress,
  resetRenewal,
  responseToClose,
  whenRenewalEnds
} from '../../src/client/lib/sessionRenewal';

// C-3 and C-4: a request that renews the caller's session (password change, new recovery codes, two-factor on or off) closes the person's sockets
// and revokes the old cookie; THIS device keeps its session and its key. A real loss (no renewal of this device) still wipes (CK-13).
// C-5: the shared-device choice is remembered for the tab, so the unlock screen starts with it.

const ADDRESS = 'alice@example.com';
const OLD_PASSWORD = 'renewal-OldPassword-3312-lantern';
const NEW_PASSWORD = 'renewal-NewPassword-8841-granite-orbit';

function memoryBackend(): KeyBackend & { records: Map<string, StoredKey> } {
  const records = new Map<string, StoredKey>();
  return {
    records,
    read: (userId) => Promise.resolve(records.get(userId) ?? null),
    write: (userId, record) => {
      records.set(userId, record);
      return Promise.resolve();
    },
    remove: (userId) => {
      records.delete(userId);
      return Promise.resolve();
    },
    users: () => [...records.keys()]
  };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/** A fetch whose answer for `holdUrl` waits until `release()`; `reached` settles once that request was made. */
function server(answers: Record<string, unknown>, holdUrl?: string) {
  const reached = deferred();
  const gate = deferred();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url === holdUrl) {
        reached.resolve();
        await gate.promise;
      }
      return Response.json({ success: true, ...(answers[url] as object | undefined) }, { status: 200 });
    })
  );
  return {
    reached: reached.promise,
    release: () => {
      gate.resolve();
    }
  };
}

const flush = () =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  resetRenewal();
});

afterEach(async () => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  setSharedDeviceStorage(undefined);
  resetRenewal();
  await wipeKeys();
});

describe('which requests renew the session, and for how long', () => {
  it.each([...RENEWAL_PATHS])('%s counts as a renewal while it runs and for a few seconds after it succeeded', async (path) => {
    const stub = server({}, path);
    const request = apiPost(path, {}, 'common.something_wrong');
    await stub.reached;
    expect(renewalInProgress()).toBe(true);
    stub.release();
    await request;
    expect(renewalInProgress()).toBe(true);
    vi.setSystemTime(Date.now() + 6000);
    expect(renewalInProgress()).toBe(false);
  });

  it('does not count a request the server refused (a wrong password renewed nothing)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(Response.json({ success: false, code: 'forbidden' }, { status: 403 })))
    );
    await expect(apiPost('/api/auth/change-password', {}, 'common.something_wrong')).rejects.toBeInstanceOf(ApiError);
    expect(renewalInProgress()).toBe(false);
  });

  it('does not count any other request', async () => {
    const stub = server({}, '/api/messages/send');
    const request = apiPost('/api/messages/send', {}, 'common.something_wrong');
    await stub.reached;
    expect(renewalInProgress()).toBe(false);
    stub.release();
    await request;
    expect(renewalInProgress()).toBe(false);
  });
});

describe('what a closed socket asks of the app', () => {
  it.each([
    [SESSION_RENEWED_CLOSE, false, 'check'],
    [SESSION_RENEWED_CLOSE, true, 'check'],
    [AUTH_FAILURE_CLOSE, false, 'wipe_and_check'],
    [AUTH_FAILURE_CLOSE, true, 'check'],
    [1000, false, 'none'],
    [1006, true, 'none']
  ] as const)('code %i, renewing %s: %s', (code, renewing, expected) => {
    expect(responseToClose(code, renewing)).toBe(expected);
  });

  it('wipes on a 4401 when this device is not renewing its session (a real loss), and asks the check at once', () => {
    const actions = { wipeKeys: vi.fn(), checkSession: vi.fn() };
    handleSocketClose(AUTH_FAILURE_CLOSE, actions);
    expect(actions.wipeKeys).toHaveBeenCalledTimes(1);
    expect(actions.checkSession).toHaveBeenCalledTimes(1);
  });

  it('on a 4402 only asks the check (another device renewed: the check wipes when this cookie is gone)', () => {
    const actions = { wipeKeys: vi.fn(), checkSession: vi.fn() };
    handleSocketClose(SESSION_RENEWED_CLOSE, actions);
    expect(actions.wipeKeys).not.toHaveBeenCalled();
    expect(actions.checkSession).toHaveBeenCalledTimes(1);
  });

  it('waits for the renewal of this device to end before it asks the check', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout'] });
    const stub = server({}, '/api/auth/2fa/recovery-codes');
    const request = apiPost('/api/auth/2fa/recovery-codes', {}, 'common.something_wrong');
    await stub.reached;
    const actions = { wipeKeys: vi.fn(), checkSession: vi.fn() };
    handleSocketClose(AUTH_FAILURE_CLOSE, actions);
    await vi.advanceTimersByTimeAsync(2000);
    expect(actions.wipeKeys).not.toHaveBeenCalled();
    expect(actions.checkSession).not.toHaveBeenCalled();
    stub.release();
    await request;
    handleSocketClose(SESSION_RENEWED_CLOSE, actions);
    // Inside the few seconds after the answer: still waiting.
    await vi.advanceTimersByTimeAsync(4000);
    expect(actions.checkSession).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2000);
    expect(actions.wipeKeys).not.toHaveBeenCalled();
    expect(actions.checkSession).toHaveBeenCalledTimes(2);
  });

  it('whenRenewalEnds calls back at once when nothing renews', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout'] });
    const callback = vi.fn();
    whenRenewalEnds(callback);
    await vi.advanceTimersByTimeAsync(600);
    expect(callback).toHaveBeenCalledTimes(1);
  });
});

describe('C-3 and C-4: a password change keeps this device signed in and unlocked', () => {
  it('keeps the key in memory and in storage when the sockets of the old session close during and after the change', async () => {
    const backend = memoryBackend();
    setKeyBackend(backend);
    const old = await deriveCredentials(OLD_PASSWORD, ADDRESS);
    const keySet = await createKeySet(old.wrapKey, generateRecoveryKey(), ADDRESS);
    await keepKey('user-a', keySet.pair, keySet.publicKey, { persist: true });
    const stub = server({ '/api/keys/me': { keys: { ...keySet.upload, keys_version: 1 }, retired: [] } }, '/api/auth/change-password');
    const spy = { wipeKeys: wipeKeysInBackground, checkSession: vi.fn() };

    const change = changePassword({ email: ADDRESS }, OLD_PASSWORD, NEW_PASSWORD);
    await stub.reached;
    // The Worker has revoked the old cookie and closes the sockets before the answer reaches the browser.
    handleSocketClose(AUTH_FAILURE_CLOSE, spy);
    handleSocketClose(SESSION_RENEWED_CLOSE, spy);
    await flush();
    expect(getUnlockedKey()).not.toBeNull();

    stub.release();
    await change;
    // A late close, a few seconds later: still this device's own renewal.
    handleSocketClose(AUTH_FAILURE_CLOSE, spy);
    await flush();
    expect(getUnlockedKey()).not.toBeNull();
    expect(backend.records.size).toBe(1);
    expect(spy.checkSession).not.toHaveBeenCalled();
  });

  it('wipes the key of a device that did not renew: another device changed the password', async () => {
    const backend = memoryBackend();
    setKeyBackend(backend);
    const old = await deriveCredentials(OLD_PASSWORD, ADDRESS);
    const keySet = await createKeySet(old.wrapKey, generateRecoveryKey(), ADDRESS);
    await keepKey('user-a', keySet.pair, keySet.publicKey, { persist: true });

    handleSocketClose(AUTH_FAILURE_CLOSE, { wipeKeys: wipeKeysInBackground, checkSession: vi.fn() });
    await flush();
    await flush();
    expect(getUnlockedKey()).toBeNull();
    expect(backend.records.size).toBe(0);
  });
});

const storageStandIn = (): FlagStorage & { values: Map<string, string> } => {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    }
  };
};

describe('C-5: the shared-device choice of this tab', () => {
  it('starts empty, remembers yes and forgets it on no', () => {
    setSharedDeviceStorage(storageStandIn());
    expect(sharedDeviceChosen()).toBe(false);
    rememberSharedDevice(true);
    expect(sharedDeviceChosen()).toBe(true);
    rememberSharedDevice(false);
    expect(sharedDeviceChosen()).toBe(false);
  });

  it('holds only a yes or no, nothing else', () => {
    const storage = storageStandIn();
    setSharedDeviceStorage(storage);
    rememberSharedDevice(true);
    expect([...storage.values.values()]).toEqual(['1']);
  });

  it('is simply empty when storage is missing or blocked', () => {
    setSharedDeviceStorage(null);
    rememberSharedDevice(true);
    expect(sharedDeviceChosen()).toBe(false);
    setSharedDeviceStorage({
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      }
    });
    expect(() => {
      rememberSharedDevice(true);
    }).not.toThrow();
    expect(sharedDeviceChosen()).toBe(false);
  });

  it('is set by an unlock on a shared device, so the next unlock starts ticked, and cleared by an unlock on a personal one', async () => {
    const backend = memoryBackend();
    setKeyBackend(backend);
    setSharedDeviceStorage(storageStandIn());
    const credentials = await deriveCredentials(OLD_PASSWORD, ADDRESS);
    const keySet = await createKeySet(credentials.wrapKey, generateRecoveryKey(), ADDRESS);
    server({ '/api/keys/me': { keys: { ...keySet.upload, keys_version: 1 }, retired: [] } });

    await unlockWithPassword({ id: 'user-a', email: ADDRESS }, OLD_PASSWORD, { persist: false });
    expect(sharedDeviceChosen()).toBe(true);
    expect(backend.records.size).toBe(0);

    await wipeKeys();
    await unlockWithPassword({ id: 'user-a', email: ADDRESS }, OLD_PASSWORD, { persist: true });
    expect(sharedDeviceChosen()).toBe(false);
    expect(backend.records.size).toBe(1);
  });

  it('is not changed by an unlock that failed', async () => {
    setKeyBackend(memoryBackend());
    setSharedDeviceStorage(storageStandIn());
    rememberSharedDevice(true);
    const credentials = await deriveCredentials(OLD_PASSWORD, ADDRESS);
    const keySet = await createKeySet(credentials.wrapKey, generateRecoveryKey(), ADDRESS);
    server({ '/api/keys/me': { keys: { ...keySet.upload, keys_version: 1 }, retired: [] } });
    await expect(unlockWithPassword({ id: 'user-a', email: ADDRESS }, 'a-wrong-password-9921-xx', { persist: true })).rejects.toThrow();
    expect(sharedDeviceChosen()).toBe(true);
  });
});
