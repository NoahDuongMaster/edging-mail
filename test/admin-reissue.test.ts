import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { addresses, auditLog, twoFactorChallenges, userSecurityEvents, users } from '../src/worker/db/schema';
import { authFor, call, createUser, db, must, signIn, userRow } from './helpers';

// Reissue of a temporary password (addendum 4.10, crypto-review.md 14.2): only for a person who never signed in with their own password and has no keys.

const REISSUE_PASSWORD = 'a second temporary password!';
const reissueBody = async (email: string, extra: Record<string, unknown> = {}) => ({
  auth: await authFor(email, REISSUE_PASSWORD),
  kdf: 1,
  ...extra
});
const reissue = (cookie: string, id: string, body: unknown) => call(`/api/admin/users/${id}/reissue`, { method: 'POST', cookie, body });
const login = (email: string, auth: string, ip: string) => call('/api/auth/login', { body: { email, auth, kdf: 1 }, ip });

async function adminSession() {
  const admin = await createUser('boss@example.com', { role: 'admin' });
  return { admin, cookie: await signIn(admin) };
}
/** An account an admin created and nobody has opened: the temporary password, no keys. */
const unopened = (email = 'newbie@example.com') => createUser(email, { mustChange: true, keys: false });

describe('reissue: a new temporary password for an account nobody has opened', () => {
  it('replaces the verifier at once (the old temporary password dies), restarts the 72 hours, ends sessions and open challenges, audits and alerts', async () => {
    const { cookie } = await adminSession();
    const other = await createUser('second@example.com', { role: 'admin' });
    const person = await unopened();
    // a session opened with the OLD temporary password, and an open second-step challenge
    const oldSession = await login(person.email, person.auth, '198.51.100.60');
    expect(oldSession.status).toBe(200);
    const oldCookie = oldSession.headers.get('Set-Cookie')?.split(';', 1)[0] ?? '';
    await db()
      .insert(twoFactorChallenges)
      .values({ jti: 'j1', user_id: person.id, attempts: 0, expires_at: Date.now() + 60_000, created_at: Date.now() });
    const before = await userRow(person.id);
    const started = Date.now();

    const answer = await reissue(cookie, person.id, await reissueBody(person.email));
    expect(answer.status).toBe(200);
    expect(answer.json).toMatchObject({ success: true, user: { email: person.email, never_signed_in: true, has_keys: false } });
    expect(answer.text).not.toMatch(/verifier|salt|"auth"|temp_password"|password"/);

    const after = await userRow(person.id);
    expect(after.auth_verifier).not.toBe(before.auth_verifier);
    expect(after.auth_salt).not.toBe(before.auth_salt);
    expect(after.temp_password_expires_at).toBeGreaterThanOrEqual(started + 72 * 3_600_000);
    expect(after).toMatchObject({ must_change_password: 1, public_key: null, status: 'active', role: 'member' });
    expect(await db().select().from(twoFactorChallenges).where(eq(twoFactorChallenges.user_id, person.id))).toEqual([]);
    // the old password and the old session are dead; the new password works and meets the first gate
    expect((await login(person.email, person.auth, '198.51.100.61')).status).toBe(401);
    expect((await call('/api/stats', { cookie: oldCookie })).status).toBe(401);
    const fresh = await login(person.email, await authFor(person.email, REISSUE_PASSWORD), '198.51.100.62');
    expect(fresh.status).toBe(200);
    expect((await call('/api/stats', { cookie: fresh.headers.get('Set-Cookie')?.split(';', 1)[0] ?? '' })).json).toMatchObject({
      code: 'password_change_required'
    });
    // audit names the admin; the other admins are alerted; the person is not (they have no session and no device)
    const audit = await db().select().from(auditLog).where(eq(auditLog.action, 'temp_password_reissued'));
    expect(audit).toMatchObject([{ actor_email: 'boss@example.com', target: person.email }]);
    expect((await db().select().from(userSecurityEvents).where(eq(userSecurityEvents.user_id, other.id))).map((row) => row.kind)).toEqual([
      'alert_temp_password_reissued'
    ]);
    expect(await db().select().from(userSecurityEvents).where(eq(userSecurityEvents.user_id, person.id))).toEqual([]);
  });

  it('never answers key material, a verifier or the submitted credential, on success or on refusal (crypto-review 14.2)', async () => {
    const { cookie } = await adminSession();
    const keyed = await createUser('keyed@example.com', { mustChange: true });
    const person = await unopened('plain@example.com');
    const body = await reissueBody(person.email);
    const refused = await reissue(cookie, keyed.id, await reissueBody(keyed.email));
    const answered = await reissue(cookie, person.id, body);
    expect([refused.status, answered.status]).toEqual([409, 200]);
    const names =
      /wrapped_private_key|public_key|key_id|keys_version|recovery_|verifier|salt|iterations|totp|rauth|"auth"|"password"|"temp_password"/;
    // every stored value that could be a key, a wrap, a verifier or a salt, of the account that was refused and of the one that was reissued
    const secretColumns = [
      'public_key',
      'key_id',
      'wrapped_private_key_pw',
      'wrapped_private_key_recovery',
      'recovery_verifier',
      'recovery_salt',
      'auth_verifier',
      'auth_salt',
      'totp_secret_enc'
    ] as const;
    const stored = [await userRow(keyed.id), await userRow(person.id)]
      .flatMap((row) => secretColumns.map((column) => row[column]))
      .filter((value): value is string => typeof value === 'string' && value.length >= 16);
    expect(stored.length).toBeGreaterThan(4);
    for (const answer of [refused, answered]) {
      expect(answer.text).not.toMatch(names);
      for (const value of stored) {
        expect(answer.text.includes(value)).toBe(false);
      }
      expect(answer.text.includes(body.auth)).toBe(false);
    }
    // and nothing that is set only by a person who holds keys appears in the view of the reissued account
    expect(Object.keys((answered.json as { user: Record<string, unknown> }).user).toSorted()).toEqual(
      [
        'aliases',
        'created_at',
        'display_name',
        'email',
        'has_keys',
        'id',
        'last_login_at',
        'never_signed_in',
        'role',
        'status',
        'temp_password_expires_at',
        'two_factor',
        'two_factor_reset_due_at'
      ].toSorted()
    );
  });

  it('works for an account whose temporary password has expired (that is the point), and not for a person with their own password or keys', async () => {
    const { cookie } = await adminSession();
    const expired = await unopened('expired@example.com');
    await db()
      .update(users)
      .set({ temp_password_expires_at: Date.now() - 1000 })
      .where(eq(users.id, expired.id));
    expect((await login(expired.email, expired.auth, '198.51.100.63')).status).toBe(401);
    expect((await reissue(cookie, expired.id, await reissueBody(expired.email))).status).toBe(200);
    expect((await login(expired.email, await authFor(expired.email, REISSUE_PASSWORD), '198.51.100.64')).status).toBe(200);
  });

  it('is refused in every other combination of "chose their own password" and "has keys", and for a disabled or missing account', async () => {
    const { cookie } = await adminSession();
    const cases: [string, Awaited<ReturnType<typeof createUser>>][] = [
      ['own password, keys', await createUser('a@example.com')],
      ['own password, no keys', await createUser('b@example.com', { keys: false })],
      ['temporary password, keys', await createUser('c@example.com', { mustChange: true })]
    ];
    const disabled = await createUser('d@example.com', { mustChange: true, keys: false, status: 'disabled' });
    cases.push(['a disabled account', disabled]);
    for (const [name, person] of cases) {
      const before = await userRow(person.id);
      const answer = await reissue(cookie, person.id, await reissueBody(person.email));
      expect([answer.status, answer.json.code], name).toEqual([409, 'reissue_refused']);
      expect(await userRow(person.id), name).toEqual(before);
    }
    expect((await reissue(cookie, 'no-such-id', await reissueBody('x@example.com'))).json).toMatchObject({ code: 'user_not_found' });
    // the administrator's own account is never "unopened"
    const self = must(await db().select().from(users).where(eq(users.email, 'boss@example.com')).get());
    expect((await reissue(cookie, self.id, await reissueBody(self.email))).json).toMatchObject({ code: 'reissue_refused' });
  });

  it('refuses a body with anything but a canonical auth and kdf 1, and leaves the account alone', async () => {
    const { cookie } = await adminSession();
    const person = await unopened();
    const before = await userRow(person.id);
    for (const body of [
      {},
      { auth: 'short', kdf: 1 },
      { ...(await reissueBody(person.email)), kdf: 2 },
      { ...(await reissueBody(person.email)), extra: 1 },
      { ...(await reissueBody(person.email)), temp_password: 'hunter2hunter2' },
      { ...(await reissueBody(person.email)), wrapped_private_key_pw: 'x' }
    ]) {
      expect((await reissue(cookie, person.id, body)).status, JSON.stringify(Object.keys(body))).toBe(400);
    }
    expect(await userRow(person.id)).toEqual(before);
    expect((await call(`/api/admin/users/${person.id}/reissue`, { cookie, body: '{"auth":' })).status).toBe(400);
  });

  it('shares the hourly cap of account creation, per administrator', async () => {
    const { admin, cookie } = await adminSession();
    const person = await unopened();
    const now = Date.now();
    for (let chunk = 0; chunk < 6; chunk += 1) {
      // D1 allows 100 bound variables per statement: ten rows of seven columns at a time
      await db()
        .insert(auditLog)
        .values(
          Array.from({ length: 10 }, () => ({
            at: now,
            actor_user_id: admin.id,
            actor_email: admin.email,
            action: 'user.create',
            target: 'x@example.com',
            detail: '{}'
          }))
        );
    }
    const before = await userRow(person.id);
    expect((await reissue(cookie, person.id, await reissueBody(person.email))).json).toMatchObject({ code: 'too_many_requests' });
    expect(
      (
        await call('/api/admin/users', {
          cookie,
          body: { local_part: 'more', domain: 'example.com', auth: await authFor('more@example.com', 'a temporary password!'), kdf: 1 }
        })
      ).status
    ).toBe(429);
    expect(await userRow(person.id)).toEqual(before);
    expect(await db().select().from(addresses).where(eq(addresses.address, 'more@example.com'))).toEqual([]);
  });
});

describe('the user list says who has not signed in yet', () => {
  it('flags `never_signed_in` with the expiry of the temporary password, for an unopened account only', async () => {
    const { cookie } = await adminSession();
    await unopened('newbie@example.com');
    await createUser('ready@example.com');
    await createUser('half@example.com', { mustChange: true });
    const listed = await call<{ users: { email: string; never_signed_in: boolean; temp_password_expires_at: number | null }[] }>(
      '/api/admin/users',
      { cookie }
    );
    const by = (email: string) => must(listed.json.users.find((user) => user.email === email));
    expect(by('newbie@example.com').never_signed_in).toBe(true);
    expect(by('ready@example.com')).toMatchObject({ never_signed_in: false, temp_password_expires_at: null });
    expect(by('half@example.com').never_signed_in).toBe(false);
    expect(listed.text).not.toMatch(/verifier|salt/);
  });
});
