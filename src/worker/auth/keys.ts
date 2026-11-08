import { and, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { batchChanges } from '../db';
import type { BatchQuery, Db } from '../db';
import { auditLog, recoveryTickets, twoFactorChallenges, userKeys, users } from '../db/schema';
import {
  CryptoFormatError,
  createSecretVerifier,
  decodeAuth,
  decodeCanonical,
  parsePublicKey,
  toBase64Url
} from '../../shared/crypto/server';
import type { Actor } from '../audit';
import type { UserRow } from './accounts';

// What the server does with key material it can never read: it checks SHAPE (a real P-256 public key whose id matches, wraps of a plausible
// size and version, a canonical `recovery_auth`), stores it, and swaps it with a compare-and-set on `keys_version`, so two concurrent
// changes cannot both win and nothing is half-applied (RR-4 / M7). The private key only ever arrives wrapped.

// A wrapped PKCS8 P-256 key is 138 bytes of key + 12 IV + 16 tag + 1 version byte = 167; engines differ a little in the PKCS8 they emit.
const MIN_WRAP_BYTES = 1 + 12 + 16 + 100;
const MAX_WRAP_BYTES = 1 + 12 + 16 + 260;
const VERSION = 1;

/** A wrapped private key as base64url text: canonical encoding, version byte 1, a plausible length. null otherwise. */
export function parseWrap(value: unknown): string | null {
  const bytes = decodeCanonical(value);
  return typeof value === 'string' &&
    bytes !== null &&
    bytes[0] === VERSION &&
    bytes.length >= MIN_WRAP_BYTES &&
    bytes.length <= MAX_WRAP_BYTES
    ? value
    : null;
}

/** A new key set as stored: the keys, both wraps, and the recovery verifier (made here from `recovery_auth`, which is not kept). */
export interface KeySet {
  public_key: string;
  key_id: string;
  wrapped_private_key_pw: string;
  wrapped_private_key_recovery: string;
  recovery_verifier: string;
  recovery_salt: string;
  recovery_iterations: number;
}

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const KEY_SET_FIELDS = new Set(['public_key', 'key_id', 'wrapped_private_key_pw', 'wrapped_private_key_recovery', 'recovery_auth']);

/**
 * The `keys` object of a key setup, a Setup or a break-glass request: exactly the five fields, each valid. The public key must be a valid
 * P-256 key and `key_id` the id of exactly that key. null otherwise.
 */
export async function parseKeySet(value: unknown): Promise<KeySet | null> {
  if (
    !isRecord(value) ||
    Object.keys(value).length !== KEY_SET_FIELDS.size ||
    !Object.keys(value).every((key) => KEY_SET_FIELDS.has(key))
  ) {
    return null;
  }
  const spki = decodeCanonical(value.public_key);
  const wrappedPw = parseWrap(value.wrapped_private_key_pw);
  const wrappedRecovery = parseWrap(value.wrapped_private_key_recovery);
  const recoveryAuth = decodeAuth(value.recovery_auth);
  if (spki === null || wrappedPw === null || wrappedRecovery === null || recoveryAuth === null) {
    return null;
  }
  try {
    const key = await parsePublicKey(spki);
    if (key.keyId !== value.key_id) {
      return null;
    }
    const verifier = await createSecretVerifier(recoveryAuth);
    return {
      public_key: toBase64Url(spki),
      key_id: key.keyId,
      wrapped_private_key_pw: wrappedPw,
      wrapped_private_key_recovery: wrappedRecovery,
      recovery_verifier: verifier.verifier,
      recovery_salt: verifier.salt,
      recovery_iterations: verifier.iterations
    };
  } catch (error) {
    if (error instanceof CryptoFormatError) {
      return null;
    }
    throw error;
  }
}

type UserUpdate = Partial<typeof users.$inferInsert>;

/** The users columns a key set writes, with the time the recovery key was made. */
export const keySetColumns = (set: KeySet, now: number): KeySet & { recovery_set_at: number } => ({ ...set, recovery_set_at: now });

export interface KeyUpdate {
  set: UserUpdate;
  actor: Actor;
  action: string;
  target: string;
  detail?: Record<string, unknown>;
  now: number;
  /** The update applies only while the account still has no key (the key setup): a stolen session cannot replace keys through it. */
  onlyWithoutKeys?: boolean;
  /** The old key goes to user_keys, with its recovery wrap only (break-glass). */
  retireOldKey?: boolean;
  /** Also end the open two-step challenges (break-glass, forgot-password). */
  dropChallenges?: boolean;
  /** Also end a pending deletion of locked mail (break-glass), see `dropLockedDeletions`. */
  dropLockedDeletions?: boolean;
}

/**
 * LK-1: ends every pending deletion of locked mail of this person. Whoever asked for one may have been somebody who only had the password; when
 * the owner recovers the account (forgot password, break-glass, a reissue, an applied two-step reset) they decide again. The caller passes the
 * guard of its own batch, so this applies only when the change it belongs to did.
 */
export const dropLockedDeletions = (db: Db, userId: string, guard: SQL): BatchQuery =>
  db
    .update(userKeys)
    .set({ delete_requested_at: null, delete_after: null })
    .where(and(eq(userKeys.user_id, userId), isNotNull(userKeys.delete_after), guard));

/** True while the row carries the stamp of the request that is writing: the later statements of a batch apply only then. */
export const appliedGuard = (row: Pick<UserRow, 'id' | 'keys_version'>, now: number): SQL =>
  sql`EXISTS (SELECT 1 FROM ${users} WHERE ${users.id} = ${row.id} AND ${users.keys_version} = ${row.keys_version + 1} AND ${users.updated_at} = ${now})`;

/**
 * Applies `set` to a user together with an audit row, in ONE batch, only while `keys_version` is still what the caller read (and, for the
 * key setup, while the account has no key). Every statement after the update carries the same guard, because a D1 batch does not stop at
 * `changes = 0`. The user's open forgot tickets die with the version they were issued for. Returns false when somebody else changed the
 * key material first: nothing was written.
 */
export async function updateKeyMaterial(db: Db, row: UserRow, update: KeyUpdate, extra: BatchQuery[] = []): Promise<boolean> {
  const retire = update.retireOldKey === true && row.key_id !== null && row.public_key !== null;
  const guard = appliedGuard(row, update.now);
  const queries: BatchQuery[] = [
    ...(retire
      ? [
          // Copies the old key from the row, but only while it is still at the version the caller read. No deletion is pending for a new row.
          db.insert(userKeys).select(
            sql`SELECT ${users.key_id}, ${users.id}, ${users.public_key}, ${users.wrapped_private_key_recovery}, ${update.now}, NULL, NULL FROM ${users}
              WHERE ${users.id} = ${row.id} AND ${users.keys_version} = ${row.keys_version} AND ${users.key_id} IS NOT NULL`
          )
        ]
      : []),
    db
      .update(users)
      .set({ ...update.set, keys_version: row.keys_version + 1, updated_at: update.now })
      .where(
        and(
          eq(users.id, row.id),
          eq(users.keys_version, row.keys_version),
          update.onlyWithoutKeys === true ? isNull(users.public_key) : undefined
        )
      ),
    db.delete(recoveryTickets).where(and(eq(recoveryTickets.user_id, row.id), guard)),
    ...(update.dropChallenges === true ? [db.delete(twoFactorChallenges).where(and(eq(twoFactorChallenges.user_id, row.id), guard))] : []),
    ...(update.dropLockedDeletions === true ? [dropLockedDeletions(db, row.id, guard)] : []),
    // The audit row exists only if the update above applied.
    db
      .insert(auditLog)
      .select(
        sql`SELECT NULL, ${update.now}, ${update.actor.id}, ${update.actor.email}, ${update.action}, ${update.target}, ${JSON.stringify(update.detail ?? {})} WHERE ${guard}`
      ),
    ...extra
  ];
  const changes = await batchChanges(db, queries);
  return changes[retire ? 1 : 0] === 1;
}
