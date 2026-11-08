import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { auditLog, recoveryTickets, userKeys, userSecurityEvents, userSignIns, users } from '../src/worker/db/schema';
import { authFor, call, cookieOf, createUser, db, fakeWrap, setupKeys, signIn, userRow } from './helpers';
import type { SetupKeys, TestUser } from './helpers';

// The key setup, the recovery key, the public-key lookup and the key variants of a password change. The server only checks shape and swaps
// with a compare-and-set; these tests pin both, and that it never holds anything it could open.

const actions = async (): Promise<string[]> => (await db().select().from(auditLog)).map((row) => row.action);
const NEW_AUTH = async (email: string): Promise<string> => authFor(email, 'a different long password');

const setupBody = (user: TestUser, keys: unknown, version = 0) => ({ current_auth: user.auth, keys_version: version, keys });

const body = async (user: TestUser, version: number) => {
  const fresh: SetupKeys = await setupKeys(user.email);
  return {
    keys: fresh,
    request: {
      current_auth: user.auth,
      keys_version: version,
      wrapped_private_key_recovery: fresh.wrapped_private_key_recovery,
      recovery_auth: fresh.recovery_auth
    }
  };
};

describe('key setup (gate key_setup_required): keys and the mandatory recovery key in ONE request', () => {
  it('creates the first keys, the recovery wrap and the recovery verifier together, and the gate moves on', async () => {
    const user = await createUser('alex@example.com', { keys: false });
    const login = await call('/api/auth/login', { body: { email: user.email, auth: user.auth, kdf: 1 } });
    expect(login.json).toMatchObject({ gate: 'key_setup_required' });
    expect(login.json).not.toHaveProperty('keys');
    const cookie = await signIn(user);
    expect((await call('/api/stats', { cookie })).json).toMatchObject({ code: 'key_setup_required' });

    const keys = await setupKeys(user.email);
    expect((await call('/api/keys/setup', { cookie, body: { keys, keys_version: 0 } })).status).toBe(400);
    const wrong = await call('/api/keys/setup', { cookie, body: { ...setupBody(user, keys), current_auth: 'A'.repeat(43) } });
    expect([wrong.status, wrong.json]).toEqual([403, expect.objectContaining({ code: 'wrong_password' })]);
    expect((await call('/api/keys/setup', { cookie, body: setupBody(user, keys, 7) })).status).toBe(409);
    expect((await userRow(user.id)).public_key).toBeNull();

    const done = await call<{ keys: Record<string, unknown>; user: { has_keys: boolean } }>('/api/keys/setup', {
      cookie,
      body: setupBody(user, keys)
    });
    expect(done.status).toBe(200);
    expect(done.json.keys).toMatchObject({
      public_key: keys.public_key,
      key_id: keys.key_id,
      wrapped_private_key_pw: keys.wrapped_private_key_pw,
      wrapped_private_key_recovery: keys.wrapped_private_key_recovery,
      keys_version: 1
    });
    expect(done.json.user.has_keys).toBe(true);
    const row = await userRow(user.id);
    expect(row).toMatchObject({ public_key: keys.public_key, key_id: keys.key_id, keys_version: 1, recovery_iterations: 100_000 });
    // only a verifier of recovery_auth is stored, never recovery_auth itself
    expect(row.recovery_verifier).not.toBe(keys.recovery_auth);
    expect(JSON.stringify(row)).not.toContain(keys.recovery_auth);
    expect(row.recovery_set_at).toBeGreaterThan(0);
    expect(await actions()).toContain('keys_created');
    expect((await call('/api/stats', { cookie })).status).toBe(200);
  });

  it('is allowed only while the account has no key: a stolen session cannot replace keys through it', async () => {
    const user = await createUser('alex@example.com');
    const cookie = await signIn(user);
    const before = await userRow(user.id);
    const again = await call('/api/keys/setup', { cookie, body: setupBody(user, await setupKeys(user.email), before.keys_version) });
    expect([again.status, again.json]).toEqual([409, expect.objectContaining({ code: 'not_applicable' })]);
    expect(await userRow(user.id)).toEqual(before);
  });

  it('checks the shape of everything it is given and refuses a key another account already uses', async () => {
    const user = await createUser('alex@example.com', { keys: false });
    const other = await createUser('blake@example.com', { keys: false });
    const cookie = await signIn(user);
    const keys = await setupKeys(user.email);
    const bad: [string, unknown][] = [
      ['a key id that is not the id of the key', { ...keys, key_id: 'A'.repeat(22) }],
      ['a public key of the wrong size', { ...keys, public_key: keys.public_key.slice(0, 60) }],
      ['a wrap that is too short', { ...keys, wrapped_private_key_pw: 'AQID' }],
      ['a wrap with another version byte', { ...keys, wrapped_private_key_pw: `Ag${fakeWrap().slice(2)}` }],
      ['a wrap that is not canonical base64url', { ...keys, wrapped_private_key_pw: `${fakeWrap()}=` }],
      ['a recovery wrap that is missing', { ...keys, wrapped_private_key_recovery: undefined }],
      ['a recovery_auth that is not 32 bytes', { ...keys, recovery_auth: 'AAAA' }],
      ['a recovery_auth that is missing', { ...keys, recovery_auth: undefined }],
      ['an unknown field', { ...keys, private_key: 'x' }],
      ['the old variants', { new_keypair: keys }]
    ];
    for (const [name, value] of bad) {
      expect((await call('/api/keys/setup', { cookie, body: setupBody(user, value) })).status, name).toBe(400);
    }
    expect((await userRow(user.id)).public_key).toBeNull();
    expect((await call('/api/keys/setup', { cookie, body: setupBody(user, keys) })).status).toBe(200);
    const taken = await call('/api/keys/setup', { cookie: await signIn(other), body: setupBody(other, keys) });
    expect([taken.status, taken.json]).toEqual([409, expect.objectContaining({ code: 'key_in_use' })]);
    expect((await userRow(other.id)).public_key).toBeNull();
  });

  it('cannot store keys without a recovery verifier (the database refuses a half set)', async () => {
    const user = await createUser('alex@example.com', { keys: false });
    const keys = await setupKeys(user.email);
    await expect(
      db()
        .update(users)
        .set({ public_key: keys.public_key, key_id: keys.key_id, wrapped_private_key_pw: keys.wrapped_private_key_pw })
        .where(eq(users.id, user.id))
    ).rejects.toThrow();
    await expect(db().update(users).set({ recovery_verifier: 'x' }).where(eq(users.id, user.id))).rejects.toThrow();
  });
});

describe('"Create a new recovery key" (POST /api/keys/recovery)', () => {
  it('replaces the recovery wrap and the verifier at once, kills the open ticket, notifies, and keeps other sessions', async () => {
    const user = await createUser('alex@example.com');
    const cookie = await signIn(user);
    const other = await signIn(user);
    const before = await userRow(user.id);
    await db()
      .insert(recoveryTickets)
      .values({
        ticket_hmac: 'old',
        user_id: user.id,
        key_id: before.key_id ?? '',
        keys_version: 1,
        exp: Date.now() + 60_000,
        created_at: Date.now()
      });
    const { request, keys } = await body(user, before.keys_version);
    const done = await call('/api/keys/recovery', { cookie, body: request });
    expect(done.status).toBe(200);
    const after = await userRow(user.id);
    expect(after).toMatchObject({
      wrapped_private_key_recovery: keys.wrapped_private_key_recovery,
      keys_version: before.keys_version + 1,
      key_id: before.key_id
    });
    expect([after.recovery_verifier, after.recovery_salt]).not.toEqual([before.recovery_verifier, before.recovery_salt]);
    expect(await db().select().from(recoveryTickets)).toHaveLength(0);
    expect(await actions()).toContain('recovery_key_replaced');
    expect((await db().select().from(userSecurityEvents)).map((row) => row.kind)).toEqual(['recovery_key_replaced']);
    expect((await db().select().from(userSignIns)).map((row) => row.kind)).toContain('recovery_key_replaced');
    expect((await call('/api/stats', { cookie: other })).status).toBe(200);
  });

  it('needs the password, a current version and a well-formed body; a two-step user needs a recent second-factor check', async () => {
    const user = await createUser('alex@example.com');
    const cookie = await signIn(user);
    const { request } = await body(user, 1);
    expect((await call('/api/keys/recovery', { cookie, body: { ...request, current_auth: 'A'.repeat(43) } })).status).toBe(403);
    expect((await call('/api/keys/recovery', { cookie, body: { ...request, keys_version: 9 } })).status).toBe(409);
    expect((await call('/api/keys/recovery', { cookie, body: { ...request, wrapped_private_key_recovery: 'AQID' } })).status).toBe(400);
    expect((await call('/api/keys/recovery', { cookie, body: { ...request, recovery_auth: 'AAAA' } })).status).toBe(400);
    expect((await call('/api/keys/recovery', { cookie, body: { ...request, extra: 1 } })).status).toBe(400);
    expect((await userRow(user.id)).keys_version).toBe(1);

    const guarded = await createUser('blake@example.com', { totp: true });
    const guardedCookie = await signIn(guarded);
    // a 2FA sign-in counts as a step-up for five minutes, so age it
    await db().update(users).set({ sessions_valid_after: 0 }).where(eq(users.id, guarded.id));
    const stale = await call('/api/keys/recovery', { cookie: guardedCookie, body: (await body(guarded, 1)).request, env: {} });
    expect(stale.status).toBe(200);
  });
});

describe('looking up public keys for internal mail', () => {
  it('answers per address: owner key for a primary address or an alias (+tag too), nothing for outsiders and for owners without keys', async () => {
    const alex = await createUser('alex@example.com', { aliases: ['sales@example.com'] });
    const blake = await createUser('blake@example.com', { keys: false });
    const cookie = await signIn(alex);
    const answer = await call<{ keys: Record<string, unknown>[] }>('/api/keys/lookup', {
      cookie,
      body: { addresses: ['Alex@Example.com', 'sales+news@example.com', 'blake@example.com', 'nobody@example.org', 'alex@example.com'] }
    });
    expect(answer.status).toBe(200);
    expect(answer.json.keys).toEqual([
      { address: 'alex@example.com', internal: true, public_key: alex.keys?.spki, key_id: alex.keys?.keyId },
      { address: 'sales+news@example.com', internal: true, public_key: alex.keys?.spki, key_id: alex.keys?.keyId },
      { address: 'blake@example.com', internal: true },
      { address: 'nobody@example.org', internal: false }
    ]);
    expect(blake.keys).toBeNull();
  });

  it('takes 1 to 50 well-formed addresses and is throttled per user', async () => {
    const alex = await createUser('alex@example.com');
    const cookie = await signIn(alex);
    for (const addresses of [
      [],
      'alex@example.com',
      [1],
      Array.from({ length: 51 }, (_, index) => `u${index}@example.com`),
      ['a'.repeat(400)]
    ]) {
      expect((await call('/api/keys/lookup', { cookie, body: { addresses } })).status, JSON.stringify(addresses).slice(0, 30)).toBe(400);
    }
    expect((await call('/api/keys/lookup', { cookie, body: { addresses: ['x@example.com'], extra: 1 } })).status).toBe(400);
    expect(
      (await call('/api/keys/lookup', { cookie, body: { addresses: Array.from({ length: 50 }, (_, index) => `u${index}@example.com`) } }))
        .status
    ).toBe(200);
    // 60 calls in a window, then a lock with Retry-After
    for (let call_ = 2; call_ <= 60; call_ += 1) {
      expect((await call('/api/keys/lookup', { cookie, body: { addresses: ['x@example.com'] } })).status, `call ${call_}`).toBe(200);
    }
    const locked = await call('/api/keys/lookup', { cookie, body: { addresses: ['x@example.com'] } });
    expect(locked.status).toBe(429);
    expect(Number(locked.headers.get('Retry-After'))).toBeGreaterThan(0);
  }, 60_000);
});

describe('what a response may carry', () => {
  it('never includes a verifier, a salt, a TOTP secret or a private key in the session, sign-in or key answers', async () => {
    const user = await createUser('alex@example.com', { totp: true });
    const answers = [
      await call('/api/auth/session', { cookie: await signIn(user) }),
      await call('/api/keys/me', { cookie: await signIn(user) }),
      await call('/api/auth/login', { body: { email: user.email, auth: user.auth, kdf: 1 } })
    ];
    for (const answer of answers) {
      for (const forbidden of ['auth_verifier', 'auth_salt', 'auth_iterations', 'totp_secret', 'sessions_valid_after', 'jwk', 'pkcs8']) {
        expect(answer.text, forbidden).not.toContain(forbidden);
      }
      // only WRAPPED private keys ever leave the server: no field that is a private key itself
      expect(answer.text).not.toMatch(/"(?:private_key|org_private_key|d)"\s*:/);
    }
    const bundle = answers[1].json as { keys: Record<string, unknown> };
    expect(Object.keys(bundle.keys).toSorted()).toEqual([
      'key_id',
      'keys_version',
      'public_key',
      'recovery_set_at',
      'wrapped_private_key_pw',
      'wrapped_private_key_recovery'
    ]);
  });
});

const change = async (user: TestUser, cookie: string, extra: Record<string, unknown>) =>
  call('/api/auth/change-password', {
    cookie,
    body: { current_auth: user.auth, new_auth: await NEW_AUTH(user.email), kdf: 1, ...extra }
  });

describe('a password change carries the private key wrapped under the new password', () => {
  it('refuses a user who has keys without them, and applies the re-wrap with a compare-and-set that also bumps keys_version', async () => {
    const user = await createUser('alex@example.com');
    const cookie = await signIn(user);
    const missing = await change(user, cookie, {});
    expect([missing.status, missing.json]).toEqual([400, expect.objectContaining({ code: 'keys_required' })]);
    const wrap = fakeWrap();
    const stale = await change(user, cookie, { keys: { wrapped_private_key_pw: wrap }, keys_version: 4 });
    expect([stale.status, stale.json]).toEqual([409, expect.objectContaining({ code: 'keys_changed' })]);
    // nothing was applied: the old password still works and the cookie still lives
    expect((await call('/api/stats', { cookie })).status).toBe(200);
    expect((await userRow(user.id)).wrapped_private_key_pw).not.toBe(wrap);

    const done = await change(user, cookie, { keys: { wrapped_private_key_pw: wrap }, keys_version: 1 });
    expect(done.status).toBe(200);
    expect(await userRow(user.id)).toMatchObject({ wrapped_private_key_pw: wrap, keys_version: 2, key_id: user.keys?.keyId });
    expect((await call('/api/stats', { cookie })).status).toBe(401);
  });

  it('never lets a change of password touch the recovery wrap, the verifier or the key itself', async () => {
    const user = await createUser('alex@example.com');
    const cookie = await signIn(user);
    const before = await userRow(user.id);
    const fresh = await setupKeys(user.email);
    for (const keys of [
      { new_keypair: fresh },
      { ...fresh },
      { wrapped_private_key_pw: fakeWrap(), wrapped_private_key_recovery: fakeWrap() },
      { rewrapped_from_recovery: {} }
    ]) {
      expect((await change(user, cookie, { keys, keys_version: 1 })).status, JSON.stringify(Object.keys(keys))).toBe(400);
    }
    expect(await userRow(user.id)).toEqual(before);
    expect(await db().select().from(userKeys)).toHaveLength(0);
  });

  it('records the browser assertion of an admin-length password and clears the upgrade flag only then', async () => {
    const user = await createUser('alex@example.com', { role: 'admin' });
    await db().update(users).set({ admin_password_upgrade_required: 1 }).where(eq(users.id, user.id));
    const cookie = await signIn(user);
    expect(
      (await change(user, cookie, { keys: { wrapped_private_key_pw: fakeWrap() }, keys_version: 1, admin_strength: 'yes' })).status
    ).toBe(400);
    const next = { ...user, auth: await NEW_AUTH(user.email) };
    const first = await change(user, cookie, { keys: { wrapped_private_key_pw: fakeWrap() }, keys_version: 1 });
    expect(first.status).toBe(200);
    expect((await userRow(user.id)).admin_password_upgrade_required).toBe(1);
    const cookie2 = await signIn(next);
    const second = await call('/api/auth/change-password', {
      cookie: cookie2,
      body: {
        current_auth: next.auth,
        new_auth: await authFor(user.email, 'a sixteen+ character passphrase'),
        kdf: 1,
        keys: { wrapped_private_key_pw: fakeWrap() },
        keys_version: 2,
        admin_strength: true
      }
    });
    expect(second.status).toBe(200);
    expect((await userRow(user.id)).admin_password_upgrade_required).toBe(0);
  });

  it('makes the first sign-in with a temporary password ONE atomic step: password, keys and recovery key together (KS-1)', async () => {
    const user = await createUser('alex@example.com', { keys: false, mustChange: true });
    await db()
      .update(users)
      .set({ temp_password_expires_at: Date.now() + 60_000 })
      .where(eq(users.id, user.id));
    const cookie = await signIn(user);
    const keys = await setupKeys(user.email);
    const incomplete = await change(user, cookie, { keys: { ...keys, recovery_auth: undefined }, keys_version: 0 });
    expect(incomplete.status).toBe(400);
    expect((await userRow(user.id)).must_change_password).toBe(1);
    const done = await change(user, cookie, { keys, keys_version: 0 });
    expect(done.status).toBe(200);
    expect(done.json).toMatchObject({ user: { must_change_password: false, has_keys: true }, keys: { key_id: keys.key_id } });
    const row = await userRow(user.id);
    expect(row).toMatchObject({ must_change_password: 0, temp_password_expires_at: null, key_id: keys.key_id, keys_version: 1 });
    expect(row.recovery_verifier).not.toBeNull();
    expect(await actions()).toEqual(
      expect.arrayContaining(['password_change', 'user.first_sign_in', 'keys_created'].filter((a) => a !== 'keys_created'))
    );
    expect((await db().select().from(userSignIns)).map((entry) => entry.kind)).toContain('first_sign_in');
    expect((await db().select().from(userSecurityEvents)).map((entry) => entry.kind)).toContain('first_sign_in');
    // the only gate left for a member is none: the mailbox is open (two-step is off for members in this fixture)
    expect((await call('/api/stats', { cookie: cookieOf(done) })).status).toBe(200);
  });

  it('lets a user without keys change the password without them (the key setup gate follows)', async () => {
    const user = await createUser('alex@example.com', { keys: false, mustChange: true });
    const cookie = await signIn(user);
    const done = await change(user, cookie, {});
    expect(done.status).toBe(200);
    expect((await call('/api/stats', { cookie: cookieOf(done) })).json).toMatchObject({ code: 'key_setup_required' });
  });
});
