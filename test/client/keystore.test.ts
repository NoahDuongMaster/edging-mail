import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createKeySet, generateRecoveryKey, toBase64Url } from '../../src/shared/crypto/client';
import type { KeySet } from '../../src/shared/crypto/client';
import { holdGateCredentials, readGateCredentials } from '../../src/client/lib/crypto/gateCredentials';
import {
  KEY_MAX_AGE_MS,
  getUnlockedKey,
  keepKey,
  onKeysWiped,
  restoreKey,
  sweepKeys,
  setKeyBackend,
  wipeKeys
} from '../../src/client/lib/crypto/keyStore';
import type { KeyBackend, StoredKey } from '../../src/client/lib/crypto/keyStore';

// The key store with an in-memory backend (workerd has no IndexedDB): where a key is kept, for how long, and when it is destroyed (CK-13).

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

/** A real key set (a non-extractable pair and its public key), made the way key setup makes it. */
async function realKeys(address: string): Promise<KeySet> {
  const wrapKey = await crypto.subtle.importKey('raw', crypto.getRandomValues(new Uint8Array(32)), 'AES-GCM', false, [
    'wrapKey',
    'unwrapKey'
  ]);
  return createKeySet(wrapKey, generateRecoveryKey(), address);
}

describe('the key store', () => {
  let backend: ReturnType<typeof memoryBackend>;
  beforeEach(() => {
    backend = memoryBackend();
    setKeyBackend(backend);
  });
  afterEach(async () => {
    await wipeKeys();
  });

  it('keeps the key in memory and one stored copy per user, with the time it was stored', async () => {
    const keys = await realKeys('a@example.com');
    const before = Date.now();
    await keepKey('user-a', keys.pair, keys.publicKey, { persist: true });
    expect(getUnlockedKey()?.userId).toBe('user-a');
    const record = backend.records.get('user-a');
    expect(record?.keyId).toBe(keys.publicKey.keyId);
    expect(record?.publicKey).toBe(toBase64Url(keys.publicKey.spki));
    expect(record?.storedAt).toBeGreaterThanOrEqual(before);
    // Never extractable: JavaScript can use the key but never read it out.
    expect(record?.privateKey.extractable).toBe(false);
  });

  it('keeps nothing stored on a shared device', async () => {
    const keys = await realKeys('a@example.com');
    backend.records.set('user-a', { privateKey: keys.pair.privateKey, publicKey: 'old', keyId: 'old', storedAt: Date.now() });
    await keepKey('user-a', keys.pair, keys.publicKey, { persist: false });
    expect(getUnlockedKey()?.userId).toBe('user-a');
    expect(backend.records.size).toBe(0);
  });

  it('wipes the previous account before another one signs in (account switch)', async () => {
    const first = await realKeys('a@example.com');
    const second = await realKeys('b@example.com');
    await keepKey('user-a', first.pair, first.publicKey, { persist: true });
    await keepKey('user-b', second.pair, second.publicKey, { persist: true });
    expect(getUnlockedKey()?.userId).toBe('user-b');
    expect([...backend.records.keys()]).toEqual(['user-b']);
  });

  it('restores a recent stored key that is the key the server holds', async () => {
    const keys = await realKeys('a@example.com');
    await keepKey('user-a', keys.pair, keys.publicKey, { persist: true });
    // A fresh page: nothing in memory, the record in storage.
    setKeyBackend(backend);
    await wipeKeys();
    backend.records.set('user-a', {
      privateKey: keys.pair.privateKey,
      publicKey: toBase64Url(keys.publicKey.spki),
      keyId: keys.publicKey.keyId,
      storedAt: Date.now()
    });
    const result = await restoreKey('user-a', { public_key: toBase64Url(keys.publicKey.spki), key_id: keys.publicKey.keyId });
    expect(result).toBe('restored');
    expect(getUnlockedKey()?.keyId).toBe(keys.publicKey.keyId);
  });

  it('deletes a stored key older than seven days and does not use it', async () => {
    const keys = await realKeys('a@example.com');
    const storedAt = Date.now() - KEY_MAX_AGE_MS - 1000;
    backend.records.set('user-a', {
      privateKey: keys.pair.privateKey,
      publicKey: toBase64Url(keys.publicKey.spki),
      keyId: keys.publicKey.keyId,
      storedAt
    });
    expect(await restoreKey('user-a', { public_key: toBase64Url(keys.publicKey.spki), key_id: keys.publicKey.keyId })).toBe('none');
    expect(backend.records.has('user-a')).toBe(false);
    expect(getUnlockedKey()).toBeNull();
  });

  it('deletes a stored key that is no longer the key the server holds (a recovery changed it)', async () => {
    const stored = await realKeys('a@example.com');
    const other = await realKeys('a@example.com');
    backend.records.set('user-a', {
      privateKey: stored.pair.privateKey,
      publicKey: toBase64Url(stored.publicKey.spki),
      keyId: stored.publicKey.keyId,
      storedAt: Date.now()
    });
    expect(await restoreKey('user-a', { public_key: toBase64Url(other.publicKey.spki), key_id: other.publicKey.keyId })).toBe('none');
    expect(backend.records.has('user-a')).toBe(false);
  });

  it('deletes a stored private key that does not belong to the public key (substituted record)', async () => {
    const real = await realKeys('a@example.com');
    const stranger = await realKeys('a@example.com');
    backend.records.set('user-a', {
      privateKey: stranger.pair.privateKey,
      publicKey: toBase64Url(real.publicKey.spki),
      keyId: real.publicKey.keyId,
      storedAt: Date.now()
    });
    expect(await restoreKey('user-a', { public_key: toBase64Url(real.publicKey.spki), key_id: real.publicKey.keyId })).toBe('none');
    expect(backend.records.has('user-a')).toBe(false);
  });

  it('the sweeper deletes every key that is not the signed-in user\u2019s, and all of them when nobody is signed in', async () => {
    const keys = await realKeys('a@example.com');
    const record: StoredKey = { privateKey: keys.pair.privateKey, publicKey: 'x', keyId: 'x', storedAt: Date.now() };
    backend.records.set('user-a', record);
    backend.records.set('user-b', record);
    await sweepKeys('user-a');
    expect([...backend.records.keys()]).toEqual(['user-a']);
    await sweepKeys(null);
    expect(backend.records.size).toBe(0);
  });

  it('the sweeper deletes a stale record of the signed-in user too', async () => {
    const keys = await realKeys('a@example.com');
    backend.records.set('user-a', {
      privateKey: keys.pair.privateKey,
      publicKey: 'x',
      keyId: 'x',
      storedAt: Date.now() - KEY_MAX_AGE_MS - 1
    });
    await sweepKeys('user-a');
    expect(backend.records.size).toBe(0);
  });

  it('a wipe empties memory and storage, runs the registered handlers and drops the gate credentials', async () => {
    const keys = await realKeys('a@example.com');
    await keepKey('user-a', keys.pair, keys.publicKey, { persist: true });
    holdGateCredentials({ email: 'a@example.com', auth: 'auth-value', wrapKey: keys.pair.privateKey, persist: true });
    let handled = 0;
    const off = onKeysWiped(() => {
      handled += 1;
    });
    await wipeKeys();
    off();
    expect(getUnlockedKey()).toBeNull();
    expect(backend.records.size).toBe(0);
    expect(handled).toBe(1);
    expect(readGateCredentials()).toBeNull();
  });
});
