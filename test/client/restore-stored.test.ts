import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createKeySet, generateRecoveryKey, toBase64Url } from '../../src/shared/crypto/client';
import { getUnlockedKey, setKeyBackend, wipeKeys } from '../../src/client/lib/crypto/keyStore';
import type { KeyBackend, StoredKey } from '../../src/client/lib/crypto/keyStore';
import { RESTORE_ATTEMPTS, restoreStoredKey } from '../../src/client/lib/crypto/restoreStored';
import type { MyKeys } from '../../src/client/lib/crypto/unlock';

// A phone that has just woken up often has no connection for a second or two. The app start asks the server for the person's keys to check the
// stored key against them; when that ask fails the person was sent to the unlock screen with a good key still stored. It asks again first.

const records = new Map<string, StoredKey>();
const backend: KeyBackend = {
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

async function storedKeys(): Promise<MyKeys> {
  const wrapKey = await crypto.subtle.importKey('raw', crypto.getRandomValues(new Uint8Array(32)), 'AES-GCM', false, [
    'wrapKey',
    'unwrapKey'
  ]);
  const keys = await createKeySet(wrapKey, generateRecoveryKey(), 'a@example.com');
  records.set('user-a', {
    privateKey: keys.pair.privateKey,
    publicKey: toBase64Url(keys.publicKey.spki),
    keyId: keys.publicKey.keyId,
    storedAt: Date.now()
  });
  return {
    keys: {
      public_key: toBase64Url(keys.publicKey.spki),
      key_id: keys.publicKey.keyId,
      wrapped_private_key_pw: 'x',
      keys_version: 1
    },
    retired: []
  };
}

describe('restoring the stored key at app start', () => {
  beforeEach(() => {
    records.clear();
    setKeyBackend(backend);
  });
  afterEach(async () => {
    await wipeKeys();
  });

  it('asks the server again when it cannot be reached and then restores the key', async () => {
    const mine = await storedKeys();
    const fetchKeys = vi
      .fn<() => Promise<MyKeys>>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(mine);
    const wait = vi.fn(() => Promise.resolve());
    await restoreStoredKey('user-a', { fetchKeys, wait });
    expect(fetchKeys).toHaveBeenCalledTimes(3);
    expect(wait.mock.calls).toEqual([[1500], [3000]]);
    expect(getUnlockedKey()?.userId).toBe('user-a');
  });

  it('gives up after a few tries and leaves the key locked for the unlock screen', async () => {
    await storedKeys();
    const fetchKeys = vi.fn<() => Promise<MyKeys>>().mockRejectedValue(new Error('offline'));
    await restoreStoredKey('user-a', { fetchKeys, wait: () => Promise.resolve() });
    expect(fetchKeys).toHaveBeenCalledTimes(RESTORE_ATTEMPTS);
    expect(getUnlockedKey()).toBeNull();
  });

  it('stops asking once the screen no longer wants the answer', async () => {
    const fetchKeys = vi.fn<() => Promise<MyKeys>>().mockRejectedValue(new Error('offline'));
    await restoreStoredKey('user-a', { fetchKeys, wait: () => Promise.resolve(), cancelled: () => true });
    expect(fetchKeys).toHaveBeenCalledTimes(1);
  });

  it('does not ask twice when the server answered, even with no key to restore', async () => {
    const fetchKeys = vi.fn<() => Promise<MyKeys>>().mockResolvedValue({ keys: null, retired: [] });
    await restoreStoredKey('user-a', { fetchKeys, wait: () => Promise.resolve() });
    expect(fetchKeys).toHaveBeenCalledTimes(1);
    expect(getUnlockedKey()).toBeNull();
  });
});
