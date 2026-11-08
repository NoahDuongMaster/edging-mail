import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { auditLog, loginAttempts, recoveryCodes, settings, twoFactorChallenges } from '../src/worker/db/schema';
import { call, cookieOf, createUser, db, enrollTotp, signIn, totpCode, userRow } from './helpers';
import type { TestUser } from './helpers';

// Two-step verification (D11, M3, RR-4): enrolment, the second sign-in step, recovery codes, step-up, and what happens when the secrets move.

const login = (user: TestUser, ip?: string) =>
  call<{ challenge: string }>('/api/auth/login', { body: { email: user.email, auth: user.auth, kdf: 1 }, ip });
const second = (body: Record<string, unknown>, options: { ip?: string; env?: Record<string, string | undefined> } = {}) =>
  call('/api/auth/login/2fa', { body, ...options });
const actions = async (): Promise<string[]> => (await db().select().from(auditLog)).map((row) => row.action);

describe('enrolment', () => {
  it('needs the password to start, a code to confirm, and shows the recovery codes once', async () => {
    const admin = await createUser('boss@example.com', { role: 'admin', totp: false });
    const first = await signIn(admin);
    expect((await call('/api/stats', { cookie: first })).json).toMatchObject({ code: 'two_factor_enrollment_required' });

    expect((await call('/api/auth/2fa/enroll/start', { cookie: first, body: {} })).status).toBe(400);
    const wrong = await call('/api/auth/2fa/enroll/start', { cookie: first, body: { current_auth: 'A'.repeat(43) } });
    expect([wrong.status, wrong.json]).toEqual([403, expect.objectContaining({ code: 'wrong_password' })]);
    // a wrong password here counts under the step-up key, never under the sign-in key
    expect((await db().select().from(loginAttempts)).map((row) => row.key)).toContain(`stepup:${admin.id}`);

    const start = await call<{ secret_base32: string; otpauth_uri: string }>('/api/auth/2fa/enroll/start', {
      cookie: first,
      body: { current_auth: admin.auth }
    });
    expect(start.status).toBe(200);
    expect(start.json.secret_base32).toMatch(/^[A-Z2-7]{32}$/);
    expect(start.json.otpauth_uri).toBe(
      `otpauth://totp/Edging%20Mail:boss%40example.com?secret=${start.json.secret_base32}&issuer=Edging%20Mail&algorithm=SHA1&digits=6&period=30`
    );
    // the secret is stored sealed under DATA_KEY, and not enabled until a code from it is confirmed
    const pending = await userRow(admin.id);
    expect(pending.totp_enabled).toBe(0);
    expect(pending.totp_secret_enc).not.toBeNull();
    expect(pending.totp_secret_enc).not.toContain(start.json.secret_base32);
    expect((await call('/api/stats', { cookie: first })).json).toMatchObject({ code: 'two_factor_enrollment_required' });

    const refused = await call('/api/auth/2fa/enroll/confirm', { cookie: first, body: { current_auth: admin.auth, code: '000000' } });
    expect([refused.status, refused.json]).toEqual([401, expect.objectContaining({ code: 'wrong_code' })]);
    expect((await userRow(admin.id)).totp_enabled).toBe(0);
  });

  it('turns it on with a correct code: ten single-use codes, other sessions ended, this device kept, audited', async () => {
    const admin = await createUser('boss@example.com', { role: 'admin', totp: false });
    const phone = await signIn(admin);
    const laptop = await signIn(admin);
    const { cookie, recoveryCodes: codes } = await enrollTotp(laptop, admin);
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const code of codes) {
      expect(code).toMatch(/^[A-Z2-7]{4}-[A-Z2-7]{4}-[A-Z2-7]{4}$/);
    }
    // only HMACs are stored: not the code, not its spelling without hyphens
    const stored = (await db().select().from(recoveryCodes).where(eq(recoveryCodes.user_id, admin.id))).map((row) => row.code_hmac);
    expect(stored).toHaveLength(10);
    for (const code of codes) {
      expect(stored).not.toContain(code);
      expect(stored).not.toContain(code.replaceAll('-', ''));
    }
    expect((await call('/api/stats', { cookie })).status).toBe(200);
    expect((await call('/api/stats', { cookie: phone })).status).toBe(401);
    expect((await call('/api/stats', { cookie: laptop })).status).toBe(401);
    expect(await actions()).toContain('2fa_enabled');
    expect((await call('/api/auth/2fa/enroll/start', { cookie, body: { current_auth: admin.auth } })).status).toBe(409);
  });

  it('refuses to confirm before it was started', async () => {
    const admin = await createUser('boss@example.com', { role: 'admin', totp: false });
    const cookie = await signIn(admin);
    const answer = await call('/api/auth/2fa/enroll/confirm', { cookie, body: { current_auth: admin.auth, code: '123456' } });
    expect([answer.status, answer.json]).toEqual([409, expect.objectContaining({ code: 'not_started' })]);
  });

  it('answers 503 and stores nothing when DATA_KEY is unusable', async () => {
    const admin = await createUser('boss@example.com', { role: 'admin', totp: false });
    const cookie = await signIn(admin);
    const answer = await call('/api/auth/2fa/enroll/start', { cookie, body: { current_auth: admin.auth }, env: { DATA_KEY: undefined } });
    expect([answer.status, answer.json]).toEqual([503, { success: false, error: 'Server is not configured', code: 'not_configured' }]);
    expect((await userRow(admin.id)).totp_secret_enc).toBeNull();
  });
});

describe('the second step of a sign-in', () => {
  it('answers a correct password with a challenge only: no cookie, no profile, no keys', async () => {
    const user = await createUser('alex@example.com', { totp: true });
    const answer = await login(user);
    expect(answer.status).toBe(200);
    expect(answer.headers.get('Set-Cookie')).toBeNull();
    expect(Object.keys(answer.json).toSorted()).toEqual(['challenge', 'success', 'two_factor_required']);
    expect(await db().select().from(twoFactorChallenges)).toHaveLength(1);
    expect(await actions()).not.toContain('sign_in');
  });

  it('signs in with a code, carries the step-up mark, and refuses the same code again (a time step works once)', async () => {
    const user = await createUser('alex@example.com', { totp: true });
    const code = await totpCode(user);
    const answer = await second({ challenge: (await login(user)).json.challenge, code });
    expect(answer.status).toBe(200);
    expect(answer.json).toMatchObject({ success: true, user: { id: user.id }, keys: { key_id: user.keys?.keyId } });
    const cookie = cookieOf(answer);
    expect(((await call('/api/auth/session', { cookie })).json as { user: { step_up_at: number } }).user.step_up_at).toBeGreaterThan(0);
    const replay = await second({ challenge: (await login(user)).json.challenge, code });
    expect([replay.status, replay.json]).toEqual([401, expect.objectContaining({ code: 'wrong_code' })]);
    // the next time step is fine
    expect((await second({ challenge: (await login(user)).json.challenge, code: await totpCode(user, 1) })).status).toBe(200);
  });

  it('uses a challenge once, lets it expire after five minutes, and burns it after five wrong codes', async () => {
    const user = await createUser('alex@example.com', { totp: true });
    const challenge = (await login(user)).json.challenge;
    expect((await second({ challenge, code: await totpCode(user) })).status).toBe(200);
    expect((await second({ challenge, code: await totpCode(user, 1) })).json).toMatchObject({ code: 'challenge_invalid' });

    const stale = (await login(user)).json.challenge;
    await db()
      .update(twoFactorChallenges)
      .set({ expires_at: Date.now() - 1000 });
    expect((await second({ challenge: stale, code: await totpCode(user, 1) })).json).toMatchObject({ code: 'challenge_invalid' });

    await db().delete(twoFactorChallenges);
    const burning = (await login(user)).json.challenge;
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      expect((await second({ challenge: burning, code: '000000' })).status, `wrong code ${attempt}`).toBe(401);
    }
    expect((await second({ challenge: burning, code: await totpCode(user, 1) })).json).toMatchObject({ code: 'challenge_invalid' });
  });

  it('does not take a session cookie for a challenge, or a challenge for a session cookie', async () => {
    const user = await createUser('alex@example.com', { totp: true });
    const cookie = await signIn(user);
    const asChallenge = await second({ challenge: cookie.replace('__Host-edging_session=', ''), code: await totpCode(user, 1) });
    expect([asChallenge.status, asChallenge.json]).toEqual([401, expect.objectContaining({ code: 'challenge_invalid' })]);
    const challenge = (await login(user)).json.challenge;
    expect((await call('/api/stats', { cookie: `edging_session=${challenge}` })).status).toBe(401);
    expect((await second({ challenge: `${challenge}x`, code: '000000' })).status).toBe(401);
  });

  it('accepts each recovery code once, in any spelling, and audits it', async () => {
    const user = await createUser('alex@example.com', { totp: false });
    const { recoveryCodes: codes } = await enrollTotp(await signIn(user), user);
    const spelling = codes[0].toLowerCase().replaceAll('-', ' ');
    const answer = await second({ challenge: (await login(user)).json.challenge, recovery_code: spelling });
    expect(answer.status).toBe(200);
    expect(await actions()).toContain('recovery_code_used');
    const again = await second({ challenge: (await login(user)).json.challenge, recovery_code: codes[0] });
    expect([again.status, again.json]).toEqual([401, expect.objectContaining({ code: 'wrong_code' })]);
    expect((await second({ challenge: (await login(user)).json.challenge, recovery_code: codes[1] })).status).toBe(200);
    expect((await second({ challenge: (await login(user)).json.challenge, recovery_code: 'AAAA-AAAA-AAAA' })).status).toBe(401);
    expect((await second({ challenge: (await login(user)).json.challenge, recovery_code: 'short' })).status).toBe(400);
  });

  it('locks the account after ten wrong codes, whatever the client address', async () => {
    const user = await createUser('alex@example.com', { totp: true });
    let challenge = (await login(user)).json.challenge;
    for (let attempt = 1; attempt <= 10; attempt += 1) {
      if (attempt % 5 === 1) {
        challenge = (await login(user, `198.51.100.${attempt}`)).json.challenge;
      }
      expect((await second({ challenge, code: '000000' }, { ip: `198.51.100.${attempt}` })).status, `attempt ${attempt}`).toBe(401);
    }
    challenge = (await login(user, '198.51.100.99')).json.challenge;
    const locked = await second({ challenge, code: await totpCode(user) }, { ip: '198.51.100.99' });
    expect(locked.status).toBe(429);
    expect(Number(locked.headers.get('Retry-After'))).toBeGreaterThan(0);
  });
});

describe('step-up, disabling and the recovery codes', () => {
  it('re-issues the cookie with a fresh step-up mark after a code', async () => {
    const user = await createUser('alex@example.com', { totp: true });
    const cookie = await signIn(user);
    expect((await call('/api/auth/step-up', { cookie, body: { code: '000000' } })).status).toBe(401);
    const answer = await call('/api/auth/step-up', { cookie, body: { code: await totpCode(user, 1) } });
    expect(answer.status).toBe(200);
    const before = ((await call('/api/auth/session', { cookie })).json as { user: { step_up_at: number } }).user.step_up_at;
    const after = ((await call('/api/auth/session', { cookie: cookieOf(answer) })).json as { user: { step_up_at: number } }).user
      .step_up_at;
    expect(after).toBeGreaterThanOrEqual(before);
    const without = await createUser('plain@example.com');
    expect((await call('/api/auth/step-up', { cookie: await signIn(without), body: { code: '123456' } })).status).toBe(409);
  });

  it('lets a member turn it off with the password and a code: secret and codes gone, other sessions ended', async () => {
    const member = await createUser('member@example.com', { totp: false });
    const { cookie, secret } = await enrollTotp(await signIn(member), member);
    const enrolled = { ...member, totpSecret: secret };
    const wrongCode = await call('/api/auth/2fa/disable', { cookie, body: { current_auth: member.auth, code: '000000' } });
    expect(wrongCode.status).toBe(401);
    const wrongPassword = await call('/api/auth/2fa/disable', {
      cookie,
      body: { current_auth: 'A'.repeat(43), code: await totpCode(enrolled, 1) }
    });
    expect(wrongPassword.status).toBe(403);
    const off = await call('/api/auth/2fa/disable', { cookie, body: { current_auth: member.auth, code: await totpCode(enrolled, 1) } });
    expect(off.status).toBe(200);
    const row = await userRow(member.id);
    expect([row.totp_enabled, row.totp_secret_enc, row.totp_enrolled_at]).toEqual([0, null, null]);
    expect(await db().select().from(recoveryCodes)).toHaveLength(0);
    expect(await actions()).toContain('2fa_disabled');
    expect((await call('/api/stats', { cookie })).status).toBe(401);
    expect((await call('/api/stats', { cookie: cookieOf(off) })).status).toBe(200);
    expect((await login(member)).json).not.toHaveProperty('two_factor_required');
  });

  it('never lets an admin turn it off, and nobody while the organisation requires it', async () => {
    const admin = await createUser('boss@example.com', { role: 'admin', totp: true });
    const adminCookie = await signIn(admin);
    const refusedAdmin = await call('/api/auth/2fa/disable', {
      cookie: adminCookie,
      body: { current_auth: admin.auth, code: await totpCode(admin, 1) }
    });
    expect([refusedAdmin.status, refusedAdmin.json]).toEqual([403, expect.objectContaining({ code: 'two_factor_required' })]);

    const member = await createUser('member@example.com', { totp: true });
    const cookie = await signIn(member);
    await db().update(settings).set({ value: '1' }).where(eq(settings.key, 'require_2fa'));
    const refused = await call('/api/auth/2fa/disable', { cookie, body: { current_auth: member.auth, code: await totpCode(member, 1) } });
    expect([refused.status, refused.json]).toEqual([403, expect.objectContaining({ code: 'two_factor_required' })]);
    expect((await userRow(member.id)).totp_enabled).toBe(1);
  });

  it('regenerates the ten recovery codes: the new ones work, the old ones do not, other sessions end', async () => {
    const user = await createUser('alex@example.com', { totp: false });
    const { cookie, secret, recoveryCodes: oldCodes } = await enrollTotp(await signIn(user), user);
    const enrolled = { ...user, totpSecret: secret };
    expect((await call('/api/auth/2fa/recovery-codes', { cookie, body: { current_auth: user.auth, code: '000000' } })).status).toBe(401);
    const fresh = await call<{ recovery_codes: string[] }>('/api/auth/2fa/recovery-codes', {
      cookie,
      body: { current_auth: user.auth, code: await totpCode(enrolled, 1) }
    });
    expect(fresh.status).toBe(200);
    expect(fresh.json.recovery_codes).toHaveLength(10);
    expect(await db().select().from(recoveryCodes)).toHaveLength(10);
    expect((await call('/api/stats', { cookie })).status).toBe(401);
    expect((await second({ challenge: (await login(user)).json.challenge, recovery_code: oldCodes[0] })).status).toBe(401);
    expect((await second({ challenge: (await login(user)).json.challenge, recovery_code: fresh.json.recovery_codes[0] })).status).toBe(200);
    expect(await actions()).toContain('recovery_codes_regenerated');
  });
});

describe('when the secrets move', () => {
  const ROTATED_JWT = 'another-jwt-secret-0123456789abcdef0123456789';

  it('refuses a password sign-in when the TOTP secret cannot be opened ("2FA broken"), and works again with DATA_KEY_PREVIOUS', async () => {
    const user = await createUser('alex@example.com', { totp: true });
    const lost = await call('/api/auth/login', {
      body: { email: user.email, auth: user.auth, kdf: 1 },
      env: { DATA_KEY: env.TEST_PREVIOUS_DATA_KEY }
    });
    expect([lost.status, lost.json]).toEqual([403, expect.objectContaining({ code: 'two_factor_broken' })]);
    expect(lost.headers.get('Set-Cookie')).toBeNull();
    const rotation = { DATA_KEY: env.TEST_PREVIOUS_DATA_KEY, DATA_KEY_PREVIOUS: env.DATA_KEY };
    const challenge = await call<{ challenge: string }>('/api/auth/login', {
      body: { email: user.email, auth: user.auth, kdf: 1 },
      env: rotation
    });
    expect(challenge.status).toBe(200);
    const done = await second({ challenge: challenge.json.challenge, code: await totpCode(user) }, { env: rotation });
    expect(done.status).toBe(200);
  });

  it('keeps two-step verification and the recovery codes through a JWT_SECRET rotation: only the sessions end', async () => {
    const user = await createUser('alex@example.com', { totp: false });
    const { cookie, secret, recoveryCodes: codes } = await enrollTotp(await signIn(user), user);
    const enrolled = { ...user, totpSecret: secret };
    expect((await call('/api/stats', { cookie })).status).toBe(200);
    expect((await call('/api/stats', { cookie, env: { JWT_SECRET: ROTATED_JWT } })).status).toBe(401);
    const rotated = { JWT_SECRET: ROTATED_JWT };
    const withCode = await call<{ challenge: string }>('/api/auth/login', {
      body: { email: user.email, auth: user.auth, kdf: 1 },
      env: rotated
    });
    expect((await second({ challenge: withCode.json.challenge, code: await totpCode(enrolled, 1) }, { env: rotated })).status).toBe(200);
    const withRecovery = await call<{ challenge: string }>('/api/auth/login', {
      body: { email: user.email, auth: user.auth, kdf: 1 },
      env: rotated
    });
    expect((await second({ challenge: withRecovery.json.challenge, recovery_code: codes[0] }, { env: rotated })).status).toBe(200);
  });
});
