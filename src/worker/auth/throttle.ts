import { and, eq, inArray, lt, sql } from 'drizzle-orm';
import type { Db } from '../db';
import { errorClass } from '../utils';
import { loginAttempts } from '../db/schema';

// Failed-attempt throttling on the login_attempts table. Key spaces: the client address (login), `setup:<client>`, `recover:<client>`,
// `acct:<normalised email>` (one account, whether or not it exists, so a lock does not reveal which addresses are real) and `global`.

export interface ThrottlePolicy {
  /** Attempts let through before the next one is refused and starts a lock. */
  attemptsPerLock: number;
  lockBaseMs: number;
  lockMaxMs: number;
  /** When set, the first `fixedLocks` locks last `lockBaseMs` and every later one `lockMaxMs` (instead of doubling each time). */
  fixedLocks?: number;
}

/** Per client address (and for setup and recovery): 5 attempts, then a 15 minute lock that doubles on each repeat up to 24 hours. */
export const CLIENT_POLICY: ThrottlePolicy = { attemptsPerLock: 5, lockBaseMs: 15 * 60_000, lockMaxMs: 24 * 60 * 60_000 };
/** Per account: 10 attempts, then a 15 minute lock, always the same length (no escalation). */
export const ACCOUNT_POLICY: ThrottlePolicy = { attemptsPerLock: 10, lockBaseMs: 15 * 60_000, lockMaxMs: 15 * 60_000 };

/**
 * The second factor at sign-in, step-up and enrolment (PB-4): 10 wrong codes, then a 15 minute lock, again 15 minutes after the next 10, and from the
 * third lock on 24 hours. Nobody can reach this counter without the password, so it may escalate (the sign-in counter must not).
 */
export const SECOND_FACTOR_POLICY: ThrottlePolicy = {
  attemptsPerLock: 10,
  lockBaseMs: 15 * 60_000,
  lockMaxMs: 24 * 60 * 60_000,
  fixedLocks: 2
};

/** Key lookups for internal mail, per user: 60 calls in 15 minutes, then a 15 minute lock. */
export const LOOKUP_POLICY: ThrottlePolicy = { attemptsPerLock: 60, lockBaseMs: 15 * 60_000, lockMaxMs: 15 * 60_000 };

/** End-to-end sends (`POST /api/messages/internal`), per user: 60 in 15 minutes, then a 15 minute lock. Each send can store a row per recipient. */
export const INTERNAL_SEND_POLICY: ThrottlePolicy = { attemptsPerLock: 60, lockBaseMs: 15 * 60_000, lockMaxMs: 15 * 60_000 };

export const WRONG_CREDENTIAL_DELAY_MS = 400;
export const GLOBAL_PRESSURE_DELAY_MS = 3000;
const ATTEMPT_WINDOW_MS = 15 * 60_000;
const RETAIN_MS = 24 * 60 * 60_000;
const GLOBAL_KEY = 'global';
const GLOBAL_WINDOW_MS = 60 * 60_000;
const GLOBAL_FAILURE_LIMIT = 20;

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

// IPv4 as is, IPv6 reduced to its /64 (one subscriber gets a whole /64), anything else shares the 'local' key.
export function clientKey(request: Request): string {
  const ip = request.headers.get('CF-Connecting-IP')?.trim() ?? '';
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(ip)) {
    return ip;
  }
  const halves = ip.split('::');
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves[1] ? halves[1].split(':') : [];
  const fill = 8 - head.length - tail.length;
  const groups = halves.length === 2 ? [...head, ...Array.from({ length: Math.max(fill, 0) }, () => '0'), ...tail] : head;
  if (halves.length > 2 || (halves.length === 2 && fill < 1) || groups.length !== 8 || !groups.every((g) => /^[\da-f]{1,4}$/i.test(g))) {
    return 'local';
  }
  return `${groups
    .slice(0, 4)
    .map((g) => Number.parseInt(g, 16).toString(16))
    .join(':')}::/64`;
}

export interface Claim {
  allowed: boolean;
  retryAfter: number;
  /** This very claim was the attempt that started a lock (not one of the refused attempts during it). */
  fresh: boolean;
}

// Counts this attempt BEFORE the credential is compared, in one atomic upsert, so parallel requests cannot all get a free comparison.
// A correct credential deletes the row (clearAttempts); a wrong one costs nothing more. One lock cycle is `attemptsPerLock + 1` numbers
// wide: 1..n are let through, n+1 is refused and locks, then the next n are let through again after the lock, and so on.
export async function claimAttempt(db: Db, key: string, now: number, policy: ThrottlePolicy): Promise<Claim> {
  const t = loginAttempts;
  const cycle = policy.attemptsPerLock + 1;
  const locked = sql`${t.locked_until} > ${now}`;
  // A row is forgotten after 24 h of silence, or once its 15-minute window is over if it never locked.
  const forgotten = sql`(${t.updated_at} < ${now - RETAIN_MS} OR (${t.locked_until} = 0 AND ${t.window_start} < ${now - ATTEMPT_WINDOW_MS}))`;
  const counted = sql`${t.failures} + 1`;
  const lockLength =
    policy.fixedLocks === undefined
      ? sql`MIN(${policy.lockMaxMs}, ${policy.lockBaseMs} * (1 << MIN((${counted}) / ${cycle} - 1, 7)))`
      : sql`CASE WHEN (${counted}) / ${cycle} > ${policy.fixedLocks} THEN ${policy.lockMaxMs} ELSE ${policy.lockBaseMs} END`;
  const rows = await db
    .insert(t)
    .values({ key, failures: 1, window_start: now, locked_until: 0, updated_at: now })
    .onConflictDoUpdate({
      target: t.key,
      set: {
        failures: sql`CASE WHEN ${forgotten} THEN 1 WHEN ${locked} THEN ${t.failures} ELSE ${counted} END`,
        window_start: sql`CASE WHEN ${forgotten} THEN ${now} ELSE ${t.window_start} END`,
        locked_until: sql`CASE WHEN ${forgotten} THEN 0 WHEN ${locked} THEN ${t.locked_until}
          WHEN (${counted}) % ${cycle} = 0 THEN ${now} + ${lockLength}
          ELSE ${t.locked_until} END`,
        updated_at: sql`CASE WHEN ${locked} THEN ${t.updated_at} ELSE ${now} END`
      }
    })
    .returning({ failures: t.failures, locked_until: t.locked_until, updated_at: t.updated_at });
  const row = rows.at(0);
  if (row === undefined) {
    throw new Error('login_attempts upsert returned no row');
  }
  // The attempt that starts a lock is the one that wrote `updated_at` (refused attempts during a lock leave it alone).
  return {
    allowed: row.failures % cycle !== 0,
    retryAfter: Math.max(1, Math.ceil((row.locked_until - now) / 1000)),
    fresh: row.failures % cycle === 0 && row.updated_at === now
  };
}

/** Counts one event in a fixed window (default one hour) under `key` and returns how many there have been in this window, this one included. */
export async function countInWindow(db: Db, key: string, now: number, windowMs = GLOBAL_WINDOW_MS): Promise<number> {
  const t = loginAttempts;
  const expired = sql`${t.window_start} < ${now - windowMs}`;
  const rows = await db
    .insert(t)
    .values({ key, failures: 1, window_start: now, locked_until: 0, updated_at: now })
    .onConflictDoUpdate({
      target: t.key,
      set: {
        failures: sql`CASE WHEN ${expired} THEN 1 ELSE ${t.failures} + 1 END`,
        window_start: sql`CASE WHEN ${expired} THEN ${now} ELSE ${t.window_start} END`,
        updated_at: now
      }
    })
    .returning({ failures: t.failures });
  return rows.at(0)?.failures ?? 0;
}

/**
 * Adds `amount` to a budget kept in a fixed window under `key`, unless that would pass `limit`: then nothing is added and the answer is
 * `ok: false` with the seconds until the window ends. One atomic upsert, so parallel requests cannot all pass the check.
 */
export async function spendBudget(
  db: Db,
  key: string,
  amount: number,
  limit: number,
  now: number,
  windowMs: number
): Promise<{ ok: boolean; retryAfter: number }> {
  const t = loginAttempts;
  const expired = sql`${t.window_start} < ${now - windowMs}`;
  const rows =
    amount > limit
      ? []
      : await db
          .insert(t)
          .values({ key, failures: amount, window_start: now, locked_until: 0, updated_at: now })
          .onConflictDoUpdate({
            target: t.key,
            set: {
              failures: sql`CASE WHEN ${expired} THEN ${amount} ELSE ${t.failures} + ${amount} END`,
              window_start: sql`CASE WHEN ${expired} THEN ${now} ELSE ${t.window_start} END`,
              updated_at: now
            },
            setWhere: sql`${expired} OR ${t.failures} + ${amount} <= ${limit}`
          })
          .returning({ failures: t.failures });
  if (rows.length > 0) {
    return { ok: true, retryAfter: 0 };
  }
  const open = await db.select({ window_start: t.window_start }).from(t).where(eq(t.key, key)).get();
  return { ok: false, retryAfter: Math.max(1, Math.ceil(((open?.window_start ?? now) + windowMs - now) / 1000)) };
}

/** A correct credential: forget the counters of these keys. Best effort, a failure is only logged. */
export async function clearAttempts(db: Db, keys: string[]): Promise<void> {
  try {
    await db.delete(loginAttempts).where(inArray(loginAttempts.key, keys));
  } catch (error) {
    console.error('[edging-mail] Could not reset the attempt counter:', errorClass(error));
  }
}

/**
 * A correct password: this request's own count on `key` is given back and nothing else is (PX-1). The client counter must survive a right
 * password, or a member could put one of their own sign-ins after every few guesses at colleagues and never be throttled; but a right password
 * must not use up the room of the others behind the same address either (an office shares one), so it only stops counting. A lock that has
 * begun is left alone. Best effort, a failure is only logged.
 */
export async function giveBackAttempt(db: Db, key: string): Promise<void> {
  try {
    await db
      .update(loginAttempts)
      .set({ failures: sql`MAX(${loginAttempts.failures} - 1, 0)` })
      .where(and(eq(loginAttempts.key, key), sql`${loginAttempts.locked_until} <= ${Date.now()}`));
  } catch (error) {
    console.error('[edging-mail] Could not give back an attempt:', errorClass(error));
  }
}

// After a wrong credential: count it in the shared hourly row, forget stale rows. True when the whole app is being hammered.
export async function recordGlobalFailure(db: Db): Promise<boolean> {
  const t = loginAttempts;
  const now = Date.now();
  const expired = sql`${t.window_start} < ${now - GLOBAL_WINDOW_MS}`;
  try {
    const [counted] = await db.batch([
      db
        .insert(t)
        .values({ key: GLOBAL_KEY, failures: 1, window_start: now, locked_until: 0, updated_at: now })
        .onConflictDoUpdate({
          target: t.key,
          set: {
            failures: sql`CASE WHEN ${expired} THEN 1 ELSE ${t.failures} + 1 END`,
            window_start: sql`CASE WHEN ${expired} THEN ${now} ELSE ${t.window_start} END`,
            updated_at: now
          }
        })
        .returning({ failures: t.failures }),
      db.delete(t).where(and(lt(t.updated_at, now - RETAIN_MS), lt(t.locked_until, now)))
    ]);
    return (counted[0]?.failures ?? 0) > GLOBAL_FAILURE_LIMIT;
  } catch (error) {
    console.error('[edging-mail] Could not record a failed sign-in:', errorClass(error));
    return false;
  }
}

/**
 * The pause after a wrong credential, counted from `startedAt` so that an unknown address and a wrong credential (which do different
 * amounts of work) take the same time to answer: fixed, and longer while the whole app is under attack.
 */
export async function failureDelay(db: Db, startedAt: number): Promise<void> {
  const underAttack = await recordGlobalFailure(db);
  await sleep(Math.max(0, WRONG_CREDENTIAL_DELAY_MS + (underAttack ? GLOBAL_PRESSURE_DELAY_MS : 0) - (Date.now() - startedAt)));
}

/** Waits until the floor (`WRONG_CREDENTIAL_DELAY_MS`) has passed since `startedAt`; nothing when it already has. */
export const holdFloor = (startedAt: number): Promise<void> => sleep(Math.max(0, WRONG_CREDENTIAL_DELAY_MS - (Date.now() - startedAt)));
