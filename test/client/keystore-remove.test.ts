import { afterEach, describe, expect, it, vi } from 'vitest';
import { createKeySet, deriveCredentials, generateRecoveryKey } from '../../src/shared/crypto/client';
import { tr } from '../../src/client/lib/i18n';
import { getUnlockedKey, indexedDbBackend, keepKey, setKeyBackend, sweepKeys, wipeKeys } from '../../src/client/lib/crypto/keyStore';

// CK-18: the stored key is deleted through IndexedDB, and the list of users that may have one (`em-key-users`) loses a user only when the database
// really was deleted. A failed or blocked delete keeps the entry, so the next start finds the user again. workerd has no IndexedDB: both it and
// `window.localStorage` are stand-ins here, and each database name answers with the event the test chose.

const INDEX_KEY = 'em-key-users';
type Outcome = 'success' | 'error' | 'blocked';

function stubBrowser(index: string[], outcomes: Record<string, Outcome>) {
  const store = new Map<string, string>([[INDEX_KEY, JSON.stringify(index)]]);
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      }
    }
  });
  const deleted: string[] = [];
  vi.stubGlobal('indexedDB', {
    deleteDatabase: (name: string) => {
      deleted.push(name);
      const outcome = outcomes[name.replace('em-keys-', '')] ?? 'success';
      const request = Object.assign(new EventTarget(), { error: outcome === 'error' ? new Error('delete refused') : null });
      queueMicrotask(() => {
        request.dispatchEvent(new Event(outcome));
      });
      return request;
    }
  });
  return { deleted, index: () => JSON.parse(store.get(INDEX_KEY) ?? '[]') as string[] };
}

const ignore = (): void => {
  // The wipe of a test that already failed on purpose.
};

afterEach(async () => {
  vi.unstubAllGlobals();
  setKeyBackend(indexedDbBackend);
  await wipeKeys().catch(ignore);
});

describe('removing a stored key', () => {
  it('drops the user from the index when the database was deleted', async () => {
    const browser = stubBrowser(['u1', 'u2'], {});
    await indexedDbBackend.remove('u1');
    expect(browser.deleted).toEqual(['em-keys-u1']);
    expect(browser.index()).toEqual(['u2']);
  });

  it('rejects on an error and keeps the entry', async () => {
    const browser = stubBrowser(['u1', 'u2'], { u1: 'error' });
    await expect(indexedDbBackend.remove('u1')).rejects.toThrow(tr('fail.key_removal'));
    expect(browser.index()).toEqual(['u1', 'u2']);
  });

  it('rejects when another tab holds the database open and keeps the entry, so the next start tries again', async () => {
    const browser = stubBrowser(['u1', 'u2'], { u1: 'blocked' });
    await expect(indexedDbBackend.remove('u1')).rejects.toThrow(tr('fail.key_removal'));
    expect(browser.index()).toEqual(['u1', 'u2']);
  });
});

describe('wiping and sweeping with a delete that does not work', () => {
  it('wipeKeys empties memory first, tries every user, reports the failure, and keeps only the failed one in the index', async () => {
    const browser = stubBrowser(['u1', 'u2'], { u1: 'blocked' });
    setKeyBackend(indexedDbBackend);
    const wrapKey = (await deriveCredentials('wipe-Password-5521-lantern-x', 'a@example.com')).wrapKey;
    const keys = await createKeySet(wrapKey, generateRecoveryKey(), 'a@example.com');
    // Memory only: `persist: false` also asks for a delete of this user, which fails quietly.
    await keepKey('u3', keys.pair, keys.publicKey, { persist: false });
    expect(getUnlockedKey()).not.toBeNull();
    await expect(wipeKeys()).rejects.toThrow(tr('fail.key_removal'));
    expect(getUnlockedKey()).toBeNull();
    expect(browser.deleted).toContain('em-keys-u2');
    expect(browser.index()).toEqual(['u1']);
  });

  it('a shared-device sign-in does not fail because an old stored copy could not be deleted', async () => {
    stubBrowser(['u3'], { u3: 'blocked' });
    setKeyBackend(indexedDbBackend);
    const wrapKey = (await deriveCredentials('wipe-Password-5521-lantern-x', 'a@example.com')).wrapKey;
    const keys = await createKeySet(wrapKey, generateRecoveryKey(), 'a@example.com');
    await expect(keepKey('u3', keys.pair, keys.publicKey, { persist: false })).resolves.toBeUndefined();
    expect(getUnlockedKey()).not.toBeNull();
  });

  it('sweepKeys goes on with the next user when one delete fails, and does not reject', async () => {
    const browser = stubBrowser(['u1', 'u2'], { u1: 'blocked' });
    setKeyBackend(indexedDbBackend);
    await expect(sweepKeys(null)).resolves.toBeUndefined();
    expect(browser.deleted).toEqual(['em-keys-u1', 'em-keys-u2']);
    expect(browser.index()).toEqual(['u1']);
  });
});
