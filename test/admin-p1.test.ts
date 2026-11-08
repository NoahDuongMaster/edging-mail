import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { app } from '../src/worker/index';
import { users } from '../src/worker/db/schema';
import { authFor, call, createUser, db, signIn, userRow } from './helpers';

// P1 (crypto-design.md 15.5): an administrator can never set, reset or read anyone's password or key material. Derived from the Hono route table:
// no /api/admin route has a password or key in its path, none accepts a credential or key field in a body except the temporary `auth` of an
// account that does not exist yet (POST /api/admin/users) or that nobody has opened (POST /api/admin/users/:id/reissue), and no answer carries key material. A route added tomorrow fails here until it
// is looked at on purpose.

const FORBIDDEN_FIELDS = [
  'password',
  'temp_password',
  'new_password',
  'current_password',
  'auth',
  'new_auth',
  'current_auth',
  'kdf',
  'wrapped_private_key_pw',
  'wrapped_private_key_recovery',
  'recovery_auth',
  'recovery_key',
  'recovery_verifier',
  'private_key',
  'public_key',
  'pkcs8',
  'jwk',
  'key',
  'keys',
  'keys_version',
  'secret',
  'setup_key',
  'totp_secret',
  'verifier'
];
const SECRET_IN_PATH = /password|auth|wrapped|recover|private|pkcs8|jwk|key|secret|verifier/i;
/** Every /api/admin route that exists, as a decision: a new one must be added here by hand, after asking whether it can touch a password or a key. */
const EXPECTED = [
  'DELETE /api/admin/domains/:id',
  'DELETE /api/admin/users/:id',
  'DELETE /api/admin/users/:id/aliases/:address',
  'GET /api/admin/audit',
  'GET /api/admin/domains',
  'GET /api/admin/domains/:id/check',
  'GET /api/admin/health',
  'GET /api/admin/settings',
  'GET /api/admin/users',
  'PATCH /api/admin/users/:id',
  'POST /api/admin/domains',
  'POST /api/admin/users',
  'POST /api/admin/users/:id/aliases',
  'POST /api/admin/users/:id/cancel-2fa-reset',
  'POST /api/admin/users/:id/reissue',
  'POST /api/admin/users/:id/reset-2fa',
  'PUT /api/admin/settings'
];
/** The routes that read no body at all (the id in the path is the whole request). */
const NO_BODY = new Set(['DELETE /api/admin/domains/:id', 'DELETE /api/admin/users/:id/aliases/:address']);
const KEY_MATERIAL =
  /wrapped_private_key|recovery_verifier|recovery_salt|auth_verifier|auth_salt|public_key|totp_secret|"verifier"|"salt"|pkcs8|"d":/;

const adminRoutes = (): { label: string; method: string; path: string }[] =>
  [
    ...new Map(
      app.routes
        .filter((route) => route.method !== 'ALL' && route.path.startsWith('/api/admin'))
        .map((route) => [`${route.method} ${route.path}`, route])
    ).values()
  ].map((route) => ({ label: `${route.method} ${route.path}`, method: route.method, path: route.path }));

describe('the /api/admin route table', () => {
  it('is exactly the list above, and no path names a password or a key', () => {
    expect(
      adminRoutes()
        .map((route) => route.label)
        .toSorted()
    ).toEqual([...EXPECTED].toSorted());
    for (const route of adminRoutes()) {
      expect(SECRET_IN_PATH.test(route.path.replace('/api/admin', '')), route.label).toBe(false);
    }
  });

  it('refuses every credential or key field on every route that reads a body, except `auth` + `kdf` on the two routes that take a temporary credential', async () => {
    const admin = await createUser('boss@example.com', { role: 'admin' });
    const cookie = await signIn(admin);
    const target = await createUser('member@example.com', { aliases: ['sales@example.com'] });
    const before = await userRow(target.id);
    const temporary = await authFor('fresh@example.com', 'a temporary password!');
    const valid = { local_part: 'fresh', domain: 'example.com', role: 'member', auth: temporary, kdf: 1 };
    // The ONLY two credentials an admin route receives: the temporary password of a new account, and of one nobody has opened (reissue).
    const credentialRoutes = new Map<string, Record<string, unknown>>([
      ['POST /api/admin/users', valid],
      ['POST /api/admin/users/:id/reissue', { auth: temporary, kdf: 1 }]
    ]);
    for (const route of adminRoutes().filter((entry) => !NO_BODY.has(entry.label) && entry.method !== 'GET')) {
      const path = route.path.replace(':id', target.id).replace(':address', 'sales%40example.com');
      const base = credentialRoutes.get(route.label);
      for (const field of FORBIDDEN_FIELDS) {
        if (base !== undefined && (field === 'auth' || field === 'kdf')) {
          continue;
        }
        const answer = await call(path, { method: route.method, cookie, body: { ...base, [field]: 'x'.repeat(43) } });
        expect([answer.status, answer.json.code], `${route.label} with ${field}`).toEqual([400, 'invalid_body']);
      }
    }
    expect([...credentialRoutes.keys()].filter((label) => !adminRoutes().some((route) => route.label === label))).toEqual([]);
    // nothing about the person changed, and no account was created by those requests
    expect(await userRow(target.id)).toEqual(before);
    expect(await db().select().from(users).where(eq(users.email, 'fresh@example.com'))).toEqual([]);
    // the exception does what it says: a NEW account from `auth`, and nothing in the answer carries it back
    const created = await call('/api/admin/users', { cookie, body: valid });
    expect(created.status).toBe(201);
    expect(created.text).not.toContain(temporary);
    // ... and a person with keys gets nothing back from the other one
    const refused = await call(`/api/admin/users/${target.id}/reissue`, { cookie, body: { auth: temporary, kdf: 1 } });
    expect([refused.status, refused.json.code]).toEqual([409, 'reissue_refused']);
    expect(await userRow(target.id)).toEqual(before);
  });

  it('ignores a body on the routes that take none: nothing of the person changes', async () => {
    const admin = await createUser('boss@example.com', { role: 'admin' });
    const cookie = await signIn(admin);
    const target = await createUser('member@example.com', { aliases: ['sales@example.com'] });
    const before = await userRow(target.id);
    const answer = await call(`/api/admin/users/${target.id}/aliases/sales%40example.com`, {
      method: 'DELETE',
      cookie,
      body: { wrapped_private_key_pw: 'x', auth: 'y', password: 'z' }
    });
    expect(answer.status).toBe(200);
    expect(await userRow(target.id)).toEqual(before);
  });

  it('never returns key material, a verifier or a secret from any read, nor from the answers to actions on a person with keys', async () => {
    const admin = await createUser('boss@example.com', { role: 'admin' });
    const cookie = await signIn(admin);
    const target = await createUser('member@example.com', { aliases: ['sales@example.com'] });
    const answers = [
      await call('/api/admin/users', { cookie }),
      await call('/api/admin/users?q=member', { cookie }),
      await call('/api/admin/domains', { cookie }),
      await call('/api/admin/health', { cookie }),
      await call('/api/admin/settings', { cookie }),
      await call('/api/admin/audit', { cookie }),
      await call(`/api/admin/users/${target.id}`, { method: 'PATCH', cookie, body: { display_name: 'Member' } }),
      await call(`/api/admin/users/${target.id}/aliases`, { cookie, body: { address: 'more@example.com' } }),
      await call(`/api/admin/users/${target.id}/reset-2fa`, { cookie, body: {} })
    ];
    for (const answer of answers) {
      expect(answer.text).not.toMatch(KEY_MATERIAL);
      expect(answer.text).not.toContain(target.keys?.spki ?? 'no-key');
    }
  });

  it('is closed to a member and to a signed-out caller on every route', async () => {
    const member = await createUser('member@example.com');
    const cookie = await signIn(member);
    for (const route of adminRoutes()) {
      const path = route.path.replace(':id', member.id).replace(':address', 'x%40example.com');
      const options = { method: route.method, body: route.method === 'GET' || route.method === 'DELETE' ? undefined : {} };
      expect((await call(path, { ...options, cookie })).json, route.label).toMatchObject({ code: 'admin_required' });
      expect((await call(path, options)).status, route.label).toBe(401);
    }
  });
});
