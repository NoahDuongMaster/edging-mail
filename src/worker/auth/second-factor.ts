import type { Context } from 'hono';
import { and, eq, inArray, isNull, lt, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { auditEntry } from '../audit';
import type { BatchQuery, Db } from '../db';
import { pushNotice, securityEvent } from '../security';
import { errorClass } from '../utils';
import { recoveryCodes, users } from '../db/schema';
import type { AppEnv } from '../types';
import { dataMacs, fromBase64Url, openData } from '../../shared/crypto/server';
import type { DataKeys } from '../../shared/crypto/server';
import type { UserRow } from './accounts';
import { dataKeysOf } from './secrets';
import { CLIENT_POLICY, claimAttempt, clearAttempts, clientKey, failureDelay, SECOND_FACTOR_POLICY } from './throttle';
import { matchingStep, newRecoveryCodes, normaliseRecoveryCode } from './totp';
import { apiError } from '../errors';

// Checking a second factor: a six-digit code or a recovery code. Used by the sign-in's second step, the step-up and the enrolment. Wrong
// guesses are throttled per account (`2fa:<id>`) and per client address, a code works once (a later time step only), a recovery code is
// consumed with a compare-and-set, and a secret that cannot be opened ("2FA broken") refuses the sign-in instead of letting it through.

const noop = (): void => {
  // best effort: a failed note about a failed code must not change the answer
};

export type FactorInput = { code: string } | { recovery: string };

/** Exactly one of `code` (six digits) and `recovery_code`, well formed. null otherwise. */
export function parseFactor(body: { code?: unknown; recovery_code?: unknown }, allowRecovery: boolean): FactorInput | null {
  if (typeof body.code === 'string' && body.recovery_code === undefined) {
    const code = body.code.replaceAll(/\s/g, '');
    return /^\d{6}$/.test(code) ? { code } : null;
  }
  if (allowRecovery && typeof body.recovery_code === 'string' && body.code === undefined) {
    const recovery = normaliseRecoveryCode(body.recovery_code);
    return recovery === null ? null : { recovery };
  }
  return null;
}

export type FactorResult = { ok: true; recovery: boolean } | { ok: false; response: Response };

/** PB-4: the lock of this account's code budget has just started. The OWNER is told (a notice that stays seven days, and a push). Best effort. */
async function tellOwnerAboutGuessing(c: Context<AppEnv>, db: Db, row: UserRow, now: number): Promise<void> {
  try {
    await db.batch([securityEvent(db, row.id, 'second_factor_locked', now, null, {})]);
    c.executionCtx.waitUntil(pushNotice(c.env, db, row.id, 'second_factor_locked', { at: now }));
  } catch (error) {
    console.error('[edging-mail] Could not note a locked second factor:', errorClass(error));
  }
}

export async function verifyFactor(c: Context<AppEnv>, db: Db, row: UserRow, input: FactorInput, startedAt: number): Promise<FactorResult> {
  const fail = (response: Response): FactorResult => ({ ok: false, response });
  const keys = await dataKeysOf(c.env);
  if (keys === undefined) {
    return fail(apiError(c, 'not_configured'));
  }
  const accountKey = `2fa:${row.id}`;
  const clientThrottle = `2fa-client:${clientKey(c.req.raw)}`;
  try {
    const byAccount = await claimAttempt(db, accountKey, startedAt, SECOND_FACTOR_POLICY);
    const byClient = await claimAttempt(db, clientThrottle, startedAt, CLIENT_POLICY);
    if (byAccount.fresh) {
      await tellOwnerAboutGuessing(c, db, row, startedAt);
    }
    if (!byAccount.allowed || !byClient.allowed) {
      const retryAfter = Math.max(byAccount.allowed ? 0 : byAccount.retryAfter, byClient.allowed ? 0 : byClient.retryAfter);
      c.header('Retry-After', String(retryAfter));
      return fail(apiError(c, 'too_many_attempts', { retry_after: retryAfter }));
    }
  } catch (error) {
    console.error('[edging-mail] Second-factor throttle unavailable:', errorClass(error));
    return fail(apiError(c, 'unavailable', { error: 'This action is temporarily unavailable' }));
  }

  let accepted: boolean;
  if ('recovery' in input) {
    accepted = await consumeRecoveryCode(db, keys, row.id, input.recovery);
  } else {
    if (row.totp_secret_enc === null) {
      return fail(apiError(c, 'not_enabled', { error: 'Two-step verification is not set up' }));
    }
    let secret;
    try {
      secret = await openData(keys, 'totp', row.id, fromBase64Url(row.totp_secret_enc));
    } catch {
      // Not "wrong code": nothing the person types can work. An admin resets it; until then password sign-in is refused too.
      return fail(apiError(c, 'two_factor_broken'));
    }
    const step = await matchingStep(secret, input.code, Date.now());
    // Compare-and-set: only a step later than the last accepted one counts, and exactly one row must change.
    const advanced =
      step === null
        ? undefined
        : await db
            .update(users)
            .set({ totp_last_step: step })
            .where(and(eq(users.id, row.id), lt(users.totp_last_step, step)))
            .run();
    accepted = advanced?.meta.changes === 1;
  }
  if (!accepted) {
    await db
      .batch([auditEntry(db, { id: row.id, email: row.email }, 'sign_in_failed', row.email, { reason: 'second_factor' })])
      .catch(noop);
    await failureDelay(db, startedAt);
    return fail(apiError(c, 'wrong_code'));
  }
  await clearAttempts(db, [accountKey, clientThrottle]);
  return { ok: true, recovery: 'recovery' in input };
}

/** A recovery code is accepted once: the row is marked used only while it is still unused, and exactly one row must change. */
async function consumeRecoveryCode(db: Db, keys: DataKeys, userId: string, code: string): Promise<boolean> {
  const { all } = await dataMacs(keys, 'recoveryCode', `${userId}\0${code}`);
  const result = await db
    .update(recoveryCodes)
    .set({ used_at: Date.now() })
    .where(and(eq(recoveryCodes.user_id, userId), inArray(recoveryCodes.code_hmac, all), isNull(recoveryCodes.used_at)))
    .run();
  return result.meta.changes === 1;
}

/** True while `updated_at` still carries the stamp of the request that is writing: the later statements of a batch apply only then. */
export const stamped = (userId: string, now: number): SQL =>
  sql`EXISTS (SELECT 1 FROM ${users} WHERE ${users.id} = ${userId} AND ${users.updated_at} = ${now})`;

/** Ten new recovery codes (shown to the person once): the queries that replace the stored HMACs. They apply only if `stamped` holds. */
export async function replaceRecoveryCodes(
  db: Db,
  keys: DataKeys,
  userId: string,
  now: number
): Promise<{ codes: string[]; queries: BatchQuery[] }> {
  const codes = newRecoveryCodes();
  const normalised = codes.map((code) => code.replaceAll('-', ''));
  const macs = await Promise.all(
    normalised.map(async (code) => {
      const { current } = await dataMacs(keys, 'recoveryCode', `${userId}\0${code}`);
      return current;
    })
  );
  return {
    codes,
    queries: [
      db.delete(recoveryCodes).where(and(eq(recoveryCodes.user_id, userId), stamped(userId, now))),
      ...macs.map((mac) => db.insert(recoveryCodes).select(sql`SELECT ${userId}, ${mac}, NULL WHERE ${stamped(userId, now)}`))
    ]
  };
}

// --- Evaluating a factor WITHOUT using it (the forgot-password flow) ---
// The forgot flow must consume a code only when the recovery key was right too (FG-1): otherwise somebody who types a wrong key with a
// right code would burn that time step. So the factor is evaluated first (always, with the same work for every kind of account), and the
// statement that uses it is added to the batch that issues the ticket.

export type EvaluatedFactor = { kind: 'totp'; step: number } | { kind: 'recovery'; macs: string[] };

const NO_SECRET = new Uint8Array(20);

/**
 * Whether `input` would be accepted for `row`, without changing anything. The same work whatever the answer: an unknown account, an account
 * without two-step verification and a missing code all go through a dummy evaluation, so the timing does not tell them apart.
 */
export async function evaluateFactor(
  db: Db,
  keys: DataKeys,
  row: UserRow | undefined,
  input: FactorInput | null
): Promise<EvaluatedFactor | null> {
  const real = row?.totp_enabled === 1;
  if (input !== null && 'recovery' in input) {
    const { all } = await dataMacs(keys, 'recoveryCode', `${real ? row.id : ''}\0${input.recovery}`);
    if (!real) {
      return null;
    }
    const found = await db
      .select({ code_hmac: recoveryCodes.code_hmac })
      .from(recoveryCodes)
      .where(and(eq(recoveryCodes.user_id, row.id), inArray(recoveryCodes.code_hmac, all), isNull(recoveryCodes.used_at)))
      .get();
    return found === undefined ? null : { kind: 'recovery', macs: all };
  }
  let secret = NO_SECRET;
  if (real && row.totp_secret_enc !== null) {
    try {
      secret = await openData(keys, 'totp', row.id, fromBase64Url(row.totp_secret_enc));
    } catch {
      secret = NO_SECRET;
    }
  }
  const step = await matchingStep(secret, input?.code ?? '000000', Date.now());
  return real && input !== null && secret !== NO_SECRET && step !== null && step > row.totp_last_step ? { kind: 'totp', step } : null;
}

/** The statement that uses an evaluated factor, stamping the row with `now` (see `factorUsed`). Changes exactly one row when it still applies. */
export const useFactorQuery = (db: Db, row: UserRow, factor: EvaluatedFactor, now: number): BatchQuery =>
  factor.kind === 'totp'
    ? db
        .update(users)
        .set({ totp_last_step: factor.step, updated_at: now })
        .where(and(eq(users.id, row.id), lt(users.totp_last_step, factor.step)))
    : db
        .update(recoveryCodes)
        .set({ used_at: now })
        .where(and(eq(recoveryCodes.user_id, row.id), inArray(recoveryCodes.code_hmac, factor.macs), isNull(recoveryCodes.used_at)));

/** True while the factor was used by the request stamped `now`: the later statements of the batch apply only then. */
export const factorUsed = (row: UserRow, factor: EvaluatedFactor, now: number): SQL =>
  factor.kind === 'totp'
    ? sql`EXISTS (SELECT 1 FROM ${users} WHERE ${users.id} = ${row.id} AND ${users.updated_at} = ${now} AND ${users.totp_last_step} = ${factor.step})`
    : sql`EXISTS (SELECT 1 FROM ${recoveryCodes} WHERE ${recoveryCodes.user_id} = ${row.id} AND ${recoveryCodes.used_at} = ${now} AND ${inArray(recoveryCodes.code_hmac, factor.macs)})`;
