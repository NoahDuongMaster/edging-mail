import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createKeySet, generateRecoveryKey } from '../../src/shared/crypto/client';
import { signOutRequest } from '../../src/client/lib/auth';
import type { SignOutPush } from '../../src/client/lib/auth';
import { getUnlockedKey, keepKey, setKeyBackend, wipeKeys } from '../../src/client/lib/crypto/keyStore';
import type { KeyBackend, StoredKey } from '../../src/client/lib/crypto/keyStore';

// CAT-3: signing out wipes the keys of this device FIRST, and what the sign-out request does cannot undo or skip that.

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

async function signedInWithAKey(backend: ReturnType<typeof memoryBackend>): Promise<void> {
  setKeyBackend(backend);
  const wrapKey = await crypto.subtle.importKey('raw', crypto.getRandomValues(new Uint8Array(32)), 'AES-GCM', false, [
    'wrapKey',
    'unwrapKey'
  ]);
  const keys = await createKeySet(wrapKey, generateRecoveryKey(), 'a@example.com');
  await keepKey('user-a', keys.pair, keys.publicKey, { persist: true });
  expect(getUnlockedKey()).not.toBeNull();
  expect(backend.records.size).toBe(1);
}

describe('sign-out', () => {
  let backend: ReturnType<typeof memoryBackend>;
  beforeEach(() => {
    backend = memoryBackend();
  });
  afterEach(async () => {
    vi.unstubAllGlobals();
    await wipeKeys();
  });

  it('has already wiped the key when the request is sent', async () => {
    await signedInWithAKey(backend);
    const seen: { unlocked: boolean; stored: number }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(() => {
        seen.push({ unlocked: getUnlockedKey() !== null, stored: backend.records.size });
        return Promise.resolve(Response.json({ success: true }));
      })
    );
    await signOutRequest();
    expect(seen).toEqual([{ unlocked: false, stored: 0 }]);
  });

  it('keeps the key wiped when the server refuses, and shows the failure', async () => {
    await signedInWithAKey(backend);
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(Response.json({ success: false, code: 'server_error' }, { status: 500 })))
    );
    await expect(signOutRequest()).rejects.toThrow();
    expect(getUnlockedKey()).toBeNull();
    expect(backend.records.size).toBe(0);
  });

  it('keeps the key wiped when the network is down, and says the server cannot be reached', async () => {
    await signedInWithAKey(backend);
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('Failed to fetch')))
    );
    await expect(signOutRequest()).rejects.toThrow(/reach the server/i);
    expect(getUnlockedKey()).toBeNull();
    expect(backend.records.size).toBe(0);
  });

  it('still sends the request when the wipe itself fails', async () => {
    await signedInWithAKey(backend);
    const remove = backend.remove.bind(backend);
    backend.remove = () => Promise.reject(new Error('storage is blocked'));
    const sent = vi.fn(() => Promise.resolve(Response.json({ success: true })));
    vi.stubGlobal('fetch', sent);
    try {
      await expect(signOutRequest()).rejects.toThrow('storage is blocked');
      expect(sent).toHaveBeenCalledTimes(1);
      // The key in memory is gone even though the stored copy could not be removed.
      expect(getUnlockedKey()).toBeNull();
    } finally {
      backend.remove = remove;
    }
  });
});

const ENDPOINT = 'https://push.example.net/send/abc123';

/** A fetch that answers the logout and notes the JSON body of each call. */
function logoutServer(answer: () => Promise<Response> = () => Promise.resolve(Response.json({ success: true }))) {
  const bodies: unknown[] = [];
  const sent = vi.fn((_url: string, init?: RequestInit) => {
    bodies.push(typeof init?.body === 'string' ? JSON.parse(init.body) : null);
    return answer();
  });
  vi.stubGlobal('fetch', sent);
  return { sent, bodies };
}

/** The push side of a sign-out, with the order of what happened written down. */
function fakePush(log: string[], over: Partial<SignOutPush> = {}): SignOutPush {
  return {
    endpoint: () => {
      log.push('endpoint read');
      return Promise.resolve(ENDPOINT);
    },
    drop: () => {
      log.push('browser unsubscribe');
      return Promise.resolve();
    },
    ...over
  };
}

const neverSettles = (): void => {
  // The executor of a promise that never settles: a push service that hangs.
};

// CK-16: Settings > Sign out used to take this device off push first and stop when that failed, which left the login and the key in place. Now the
// key is wiped first; the endpoint of this browser's push subscription is read (best effort, capped) and travels WITH the logout request, where the
// Worker deletes that one subscription in the same batch that ends the sessions; the browser's own unsubscribe comes after the answer.
describe('sign-out with the push subscription (CK-16)', () => {
  let backend: ReturnType<typeof memoryBackend>;
  beforeEach(() => {
    backend = memoryBackend();
  });
  afterEach(async () => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    await wipeKeys();
  });

  it('wipes the key, reads the endpoint, sends it with the logout request, and unsubscribes in the browser after the answer, in that order', async () => {
    await signedInWithAKey(backend);
    const log: string[] = [];
    const key = (): string => `key ${getUnlockedKey() === null ? 'gone' : 'present'}, stored ${String(backend.records.size)}`;
    const { bodies } = logoutServer(() => {
      log.push(`logout request (${key()})`);
      return Promise.resolve(Response.json({ success: true }));
    });
    await signOutRequest(
      fakePush(log, {
        endpoint: () => {
          log.push(`endpoint read (${key()})`);
          return Promise.resolve(ENDPOINT);
        }
      })
    );
    expect(log).toEqual(['endpoint read (key gone, stored 0)', 'logout request (key gone, stored 0)', 'browser unsubscribe']);
    expect(bodies).toEqual([{ push_endpoint: ENDPOINT }]);
  });

  it('sends an empty body and unsubscribes nothing when the browser has no push subscription', async () => {
    await signedInWithAKey(backend);
    const log: string[] = [];
    const { bodies } = logoutServer();
    await signOutRequest(fakePush(log, { endpoint: () => Promise.resolve(null) }));
    expect(bodies).toEqual([{}]);
    expect(log).toEqual([]);
    expect(getUnlockedKey()).toBeNull();
  });

  it('sends no push field at all without a push helper (a sign-out from a browser that cannot do push)', async () => {
    await signedInWithAKey(backend);
    const { bodies } = logoutServer();
    await signOutRequest();
    expect(bodies).toEqual([{}]);
  });

  it('goes on with an empty logout body when reading the subscription rejects', async () => {
    await signedInWithAKey(backend);
    const log: string[] = [];
    const { sent, bodies } = logoutServer();
    await signOutRequest(fakePush(log, { endpoint: () => Promise.reject(new Error('push service unreachable')) }));
    expect(sent).toHaveBeenCalledTimes(1);
    expect(bodies).toEqual([{}]);
    expect(log).toEqual([]);
    expect(getUnlockedKey()).toBeNull();
    expect(backend.records.size).toBe(0);
  });

  it('does not wait for a subscription lookup that hangs: the key is gone at once and the logout goes after the 8 s cap, without the endpoint', async () => {
    await signedInWithAKey(backend);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { sent, bodies } = logoutServer();
    const done = signOutRequest(fakePush([], { endpoint: () => new Promise<never>(neverSettles) }));
    await vi.advanceTimersByTimeAsync(100);
    expect(getUnlockedKey()).toBeNull();
    expect(backend.records.size).toBe(0);
    expect(sent).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(8000);
    await done;
    expect(sent).toHaveBeenCalledTimes(1);
    expect(bodies).toEqual([{}]);
  });

  it('keeps the browser subscription when the logout fails: the person may still be signed in', async () => {
    await signedInWithAKey(backend);
    const log: string[] = [];
    logoutServer(() => Promise.resolve(Response.json({ success: false, code: 'server_error' }, { status: 500 })));
    await expect(signOutRequest(fakePush(log))).rejects.toThrow();
    expect(log).toEqual(['endpoint read']);
    expect(getUnlockedKey()).toBeNull();
    expect(backend.records.size).toBe(0);
  });

  it('with the network down the person is signed out of this device anyway: no key in memory or storage, the subscription kept, the failure shown', async () => {
    await signedInWithAKey(backend);
    const log: string[] = [];
    logoutServer(() => Promise.reject(new TypeError('Failed to fetch')));
    await expect(signOutRequest(fakePush(log))).rejects.toThrow(/reach the server/i);
    expect(log).toEqual(['endpoint read']);
    expect(getUnlockedKey()).toBeNull();
    expect(backend.records.size).toBe(0);
  });

  it('is signed out even when the browser unsubscribe rejects', async () => {
    await signedInWithAKey(backend);
    logoutServer();
    await expect(
      signOutRequest(fakePush([], { drop: () => Promise.reject(new Error('push service unreachable')) }))
    ).resolves.toBeUndefined();
    expect(getUnlockedKey()).toBeNull();
  });

  it('does not wait for a browser unsubscribe that hangs longer than the cap', async () => {
    await signedInWithAKey(backend);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    logoutServer();
    let finished = false;
    const done = signOutRequest(fakePush([], { drop: () => new Promise<never>(neverSettles) })).then(() => {
      finished = true;
    });
    await vi.advanceTimersByTimeAsync(100);
    expect(finished).toBe(false);
    await vi.advanceTimersByTimeAsync(8000);
    await done;
    expect(finished).toBe(true);
  });
});
