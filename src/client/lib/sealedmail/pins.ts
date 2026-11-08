import { decodeCanonical, P256_SPKI_BYTES } from '../../../shared/crypto/client';
import { getUnlockedKey, onKeysWiped } from '../crypto/keyStore';
import { isRecord } from './helpers';
import type { KeyAnswer } from './types';

// S3, key pinning on first use: the first key a person is seen with is remembered under their address; a later key that differs is a
// CHANGE the sender must confirm (it can be a new device and a new password, or someone in the middle). What is stored is public: addresses, key
// ids, public keys and a time. The record is not a secret, so a sign-out does not delete it; it is written only on a personal device (the same
// choice as the key itself: `persisted`), and on a shared device it lives in this page's memory until the keys are wiped.

/**
 * `was_keyed`: a key was pinned for this address, and the lookup now says it has none (no keys yet, or not on this server): EC-2, a downgrade.
 * EC-9: once the person confirmed that an address is outside this server now, the pin stays (a later key for the same address must still be
 * confirmed, S3) but the question is not asked again for as long as the answer stays "no key".
 */
export type PinState = 'new' | 'same' | 'changed' | 'was_keyed';

export interface PinEntry {
  keyId: string;
  /** The public key (SPKI), base64url. */
  spki: string;
  /** Epoch ms the key was first trusted. */
  firstSeen: number;
  /** Epoch ms the person confirmed that this address is no longer on this server (EC-9): the "was keyed" question is not asked again until a key shows up. */
  gone?: number;
}

export interface PinCheck {
  state: PinState;
  /** What is pinned for the address now (null for `new`). */
  pinned: PinEntry | null;
}

/** The part of `localStorage` used here; tests pass their own. */
export type PinStorage = Pick<Storage, 'getItem' | 'setItem'>;

const MAX_PINS = 5000;

export const pinsStorageKey = (userId: string): string => `edging-mail-pins:${userId}`;

let override: PinStorage | null | undefined;

/** Tests only: a stand-in for localStorage (null: no storage at all; undefined: the real one again). */
export function setPinStorage(storage: PinStorage | null | undefined): void {
  override = storage;
}

function storageOf(): PinStorage | null {
  if (override !== undefined) {
    return override;
  }
  try {
    return (globalThis as { localStorage?: Storage }).localStorage ?? null;
  } catch {
    return null;
  }
}

/** Written to storage only for the person whose key is unlocked here, and only when they chose a personal device. */
const isPersisted = (userId: string): boolean => {
  const key = getUnlockedKey();
  return key !== null && key.userId === userId && key.persisted;
};

const validEntry = (value: unknown): value is PinEntry =>
  isRecord(value) &&
  typeof value.keyId === 'string' &&
  /^[\w-]{22}$/.test(value.keyId) &&
  decodeCanonical(value.spki, P256_SPKI_BYTES) !== null &&
  typeof value.firstSeen === 'number' &&
  Number.isFinite(value.firstSeen) &&
  (value.gone === undefined || (typeof value.gone === 'number' && Number.isFinite(value.gone)));

/** What storage holds for the user: anything damaged is dropped (corrupt storage is an empty book, never an exception). */
function readStored(userId: string): Map<string, PinEntry> {
  const book = new Map<string, PinEntry>();
  try {
    const parsed: unknown = JSON.parse(storageOf()?.getItem(pinsStorageKey(userId)) ?? 'null');
    if (isRecord(parsed) && isRecord(parsed.pins)) {
      for (const [address, entry] of Object.entries(parsed.pins)) {
        if (validEntry(entry)) {
          book.set(address, {
            keyId: entry.keyId,
            spki: entry.spki,
            firstSeen: entry.firstSeen,
            ...(entry.gone === undefined ? {} : { gone: entry.gone })
          });
        }
      }
    }
  } catch {
    book.clear();
  }
  return book;
}

// The pins of each user seen since the last wipe. A wipe (sign-out, 401, account switch) forgets all of it; the stored copy stays.
const memory = new Map<string, Map<string, PinEntry>>();
onKeysWiped(() => memory.clear());

/** The user's pins now: memory, plus (on a personal device) storage, which wins: another tab may have accepted a change. */
function bookOf(userId: string): Map<string, PinEntry> {
  const known = memory.get(userId) ?? new Map<string, PinEntry>();
  const book = isPersisted(userId) ? new Map([...known, ...readStored(userId)]) : known;
  memory.set(userId, book);
  return book;
}

function save(userId: string, book: Map<string, PinEntry>): void {
  while (book.size > MAX_PINS) {
    const oldest = [...book].toSorted((a, b) => a[1].firstSeen - b[1].firstSeen)[0];
    book.delete(oldest[0]);
  }
  if (!isPersisted(userId)) {
    return;
  }
  try {
    storageOf()?.setItem(pinsStorageKey(userId), JSON.stringify({ v: 1, pins: Object.fromEntries(book) }));
  } catch {
    // Storage full or blocked: the pins still hold for this visit.
  }
}

const keyOf = (address: string): string => address.trim().toLowerCase();

const stateOf = (pinned: PinEntry | null, keyId: string): PinState => {
  if (pinned === null) {
    return 'new';
  }
  return pinned.keyId === keyId ? 'same' : 'changed';
};

/**
 * For every address in `answers`: with a key, is it the first time (`new`), the pinned key (`same`) or another one (`changed`)? Without a key
 * (an account that has none, or an address outside this server) but with a pin from an earlier send: `was_keyed`, the server now says that a
 * person it showed keys for has none, unless the person already confirmed that (EC-9, `gone`). Nothing is pinned here; the only write is that a
 * key that is the pinned one again ends the "gone" state, so a later disappearance is asked about afresh.
 */
export function compareWithPins(userId: string, answers: ReadonlyMap<string, KeyAnswer>): Map<string, PinCheck> {
  const book = bookOf(userId);
  const checks = new Map<string, PinCheck>();
  for (const [address, answer] of answers) {
    const pinned = book.get(keyOf(address)) ?? null;
    if (answer.keyId === undefined) {
      if (pinned !== null && pinned.gone === undefined) {
        checks.set(address, { state: 'was_keyed', pinned });
      }
      continue;
    }
    const state = stateOf(pinned, answer.keyId);
    if (state === 'same' && pinned?.gone !== undefined) {
      const { gone: _gone, ...kept } = pinned;
      book.set(keyOf(address), kept);
      save(userId, book);
      checks.set(address, { state, pinned: kept });
      continue;
    }
    checks.set(address, { state, pinned });
  }
  return checks;
}

/**
 * EC-9: the person confirmed the `was_keyed` question for an address the server now says is outside (it left). The pin stays, so a key that
 * appears for that address later is still a change to confirm (a deleted and re-created account, S3), but the same question is not asked on every
 * send for good. Does nothing for an address without a pin.
 */
export function markGone(userId: string, address: string): void {
  const book = bookOf(userId);
  const pinned = book.get(keyOf(address));
  if (pinned === undefined || pinned.gone !== undefined) {
    return;
  }
  book.set(keyOf(address), { ...pinned, gone: Date.now() });
  save(userId, book);
}

/** Trust on first use: remembers the key of an address that has none yet. Never replaces another key (that is `acceptChange`). True when it pinned. */
export function pin(userId: string, address: string, entry: PinEntry): boolean {
  const book = bookOf(userId);
  if (book.has(keyOf(address))) {
    return false;
  }
  book.set(keyOf(address), entry);
  save(userId, book);
  return true;
}

/** The person accepted a changed key: it replaces the pinned one. */
export function acceptChange(userId: string, address: string, entry: PinEntry): void {
  const book = bookOf(userId);
  book.set(keyOf(address), entry);
  save(userId, book);
}
