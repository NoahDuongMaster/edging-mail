import { assertKeyPair, fromBase64Url, parsePublicKey, toBase64Url } from '../../../shared/crypto/client';
import type { PublicKey } from '../../../shared/crypto/client';
import { tr } from '../i18n';

// Where the user's private key lives in the browser (CK-13, design.md section 18). The key is always NON-extractable: JavaScript can use it
// to decrypt but cannot read it out. Two places:
//   - memory: the key in use. Gone with the page.
//   - IndexedDB, ONE database per user id, unless the person ticked "shared device" at sign-in (then memory only). The record carries
//     `storedAt`; the app deletes it at the next start when it is older than seven days (shorter than the 14-day cookie), when there is no
//     valid session for that user, and on sign-out, on any 401 of an authenticated route, on an auth-failure close of the live socket and
//     when another account signs in. Nothing decrypted is ever written down: lists, readers and search data live in memory only.

/** A stored key is not used after this long: the person unlocks with the password again. */
export const KEY_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export interface UnlockedKey {
  userId: string;
  pair: CryptoKeyPair;
  publicKey: PublicKey;
  keyId: string;
  /** False on a shared device: nothing of this person (the key, the pinned recipient keys) is written to storage. */
  persisted: boolean;
}

/** What is stored for one user. `publicKey` (SPKI, base64url) lets the next start check it against the server's before it trusts the key. */
export interface StoredKey {
  privateKey: CryptoKey;
  publicKey: string;
  keyId: string;
  storedAt: number;
}

/** The storage behind the key store: IndexedDB in the browser, an in-memory fake in the tests (workerd has no IndexedDB). */
export interface KeyBackend {
  read: (userId: string) => Promise<StoredKey | null>;
  write: (userId: string, record: StoredKey) => Promise<void>;
  remove: (userId: string) => Promise<void>;
  /** The user ids that may have a record: the browser keeps this list next to the databases, so a sweep needs no `indexedDB.databases()`. */
  users: () => string[];
}

const INDEX_KEY = 'em-key-users';
const DB_PREFIX = 'em-keys-';
const STORE = 'key';

const readIndex = (): string[] => {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(INDEX_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
};

const writeIndex = (ids: string[]): void => {
  try {
    window.localStorage.setItem(INDEX_KEY, JSON.stringify(ids));
  } catch {
    // Storage blocked: nothing is kept, so there is nothing to sweep.
  }
};

const openDatabase = (userId: string): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open(`${DB_PREFIX}${userId}`, 1);
    request.addEventListener('upgradeneeded', () => {
      request.result.createObjectStore(STORE);
    });
    request.addEventListener('success', () => {
      resolve(request.result);
    });
    request.addEventListener('error', () => {
      reject(request.error ?? new Error('IndexedDB is not available'));
    });
  });

const settle = <T>(request: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    request.addEventListener('success', () => {
      resolve(request.result);
    });
    request.addEventListener('error', () => {
      reject(request.error ?? new Error('IndexedDB request failed'));
    });
  });

export const indexedDbBackend: KeyBackend = {
  async read(userId) {
    const db = await openDatabase(userId);
    try {
      const value = await settle<unknown>(db.transaction(STORE, 'readonly').objectStore(STORE).get('current'));
      const record = value as Partial<StoredKey> | undefined;
      return record?.privateKey instanceof CryptoKey &&
        typeof record.publicKey === 'string' &&
        typeof record.keyId === 'string' &&
        typeof record.storedAt === 'number'
        ? { privateKey: record.privateKey, publicKey: record.publicKey, keyId: record.keyId, storedAt: record.storedAt }
        : null;
    } finally {
      db.close();
    }
  },
  async write(userId, record) {
    const db = await openDatabase(userId);
    try {
      await settle(db.transaction(STORE, 'readwrite').objectStore(STORE).put(record, 'current'));
      writeIndex([...new Set([...readIndex(), userId])]);
    } finally {
      db.close();
    }
  },
  async remove(userId) {
    // The index entry goes only when the database really was deleted (CK-18): a failed or blocked delete keeps it, so the sweeper at the next
    // start finds this user again and tries once more.
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(`${DB_PREFIX}${userId}`);
      request.addEventListener('success', () => {
        resolve();
      });
      request.addEventListener('error', () => {
        reject(new Error(tr('fail.key_removal')));
      });
      // Another tab holds the database open: it is deleted when that tab lets go, and the key is unreachable from here on.
      request.addEventListener('blocked', () => {
        reject(new Error(tr('fail.key_removal')));
      });
    });
    writeIndex(readIndex().filter((id) => id !== userId));
  },
  users: readIndex
};

let backend: KeyBackend = indexedDbBackend;
let unlocked: UnlockedKey | null = null;
const listeners = new Set<() => void>();
const wipeHandlers = new Set<() => void>();

/** Tests only. */
export function setKeyBackend(next: KeyBackend): void {
  backend = next;
}

const notify = (): void => {
  for (const listener of listeners) {
    listener();
  }
};

export const getUnlockedKey = (): UnlockedKey | null => unlocked;

export function subscribeUnlockedKey(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Registers code that must forget its secrets whenever the keys are wiped (the gate credentials, any decrypted cache). */
export function onKeysWiped(handler: () => void): () => void {
  wipeHandlers.add(handler);
  return () => wipeHandlers.delete(handler);
}

/**
 * Makes `pair` the key in use. Another user's key is wiped first (an account switch), and a key stored for this user is replaced.
 * `persist: false` is the shared-device choice: memory only, and nothing is left in IndexedDB.
 */
export async function keepKey(userId: string, pair: CryptoKeyPair, publicKey: PublicKey, options: { persist: boolean }): Promise<void> {
  if (unlocked !== null && unlocked.userId !== userId) {
    await wipeKeys();
  }
  unlocked = { userId, pair, publicKey, keyId: publicKey.keyId, persisted: options.persist };
  if (options.persist) {
    try {
      await backend.write(userId, {
        privateKey: pair.privateKey,
        publicKey: toBase64Url(publicKey.spki),
        keyId: publicKey.keyId,
        storedAt: Date.now()
      });
    } catch {
      // IndexedDB refused (a private window, a full disk): the key still works for this visit and the next start unlocks with the password.
    }
  } else {
    try {
      await backend.remove(userId);
    } catch {
      // A copy from an earlier personal sign-in could not be deleted now (blocked by another tab): its index entry stays, so the sweeper tries again.
    }
  }
  notify();
}

export type RestoreResult = 'restored' | 'none';

/**
 * At app start, with a valid session: uses the key stored for this user if it is recent, is the key the server holds now, and still
 * belongs to its public key. Anything else deletes the record, and the person unlocks with the password.
 */
export async function restoreKey(userId: string, server: { public_key: string; key_id: string }, now = Date.now()): Promise<RestoreResult> {
  if (unlocked?.userId === userId) {
    return 'restored';
  }
  let record: StoredKey | null;
  try {
    record = await backend.read(userId);
  } catch {
    return 'none';
  }
  if (record === null) {
    return 'none';
  }
  if (
    now - record.storedAt > KEY_MAX_AGE_MS ||
    record.storedAt > now + 60_000 ||
    record.publicKey !== server.public_key ||
    record.keyId !== server.key_id
  ) {
    await backend.remove(userId);
    return 'none';
  }
  try {
    const publicKey = await parsePublicKey(fromBase64Url(server.public_key));
    await assertKeyPair(record.privateKey, publicKey);
    unlocked = {
      userId,
      pair: { privateKey: record.privateKey, publicKey: publicKey.key },
      publicKey,
      keyId: publicKey.keyId,
      persisted: true
    };
    notify();
    return 'restored';
  } catch {
    await backend.remove(userId);
    return 'none';
  }
}

/**
 * Run at every app start once the session is known: deletes the stored key of every user but the one with a valid session, and any
 * record older than seven days. `currentUserId` is null when nobody is signed in, which deletes everything.
 */
export async function sweepKeys(currentUserId: string | null, now = Date.now()): Promise<void> {
  for (const userId of backend.users()) {
    let stale = userId !== currentUserId;
    if (!stale) {
      try {
        const record = await backend.read(userId);
        stale = record === null || now - record.storedAt > KEY_MAX_AGE_MS;
      } catch {
        stale = true;
      }
    }
    if (stale) {
      try {
        await backend.remove(userId);
      } catch {
        // The delete failed or is blocked by another tab: the index entry stays (CK-18), so the next start tries again. The other users go on.
      }
    }
  }
}

/** Sign-out, a 401, an auth-failure close of the live socket, an account switch: the key leaves memory and every stored copy is deleted. */
export async function wipeKeys(): Promise<void> {
  unlocked = null;
  for (const handler of wipeHandlers) {
    handler();
  }
  notify();
  // Every stored copy is attempted even when one removal fails; the first failure is reported after all of them were tried.
  const results = await Promise.allSettled(backend.users().map((userId) => backend.remove(userId)));
  const failed = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
  if (failed !== undefined) {
    throw failed.reason;
  }
}

/** `wipeKeys` for callers that cannot wait for it or react to its failure (a query callback, an event handler): the key is already gone from memory. */
export function wipeKeysInBackground(): void {
  wipeKeys().catch(() => {
    // Storage refused the removal: the sweeper deletes the stored copy at the next start.
  });
}
