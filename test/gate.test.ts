import { describe, expect, it } from 'vitest';
import { app } from '../src/worker/index';
import { eq } from 'drizzle-orm';
import { settings, users } from '../src/worker/db/schema';
import { call, createUser, db, ORIGIN, signIn } from './helpers';

// S12 / CR-7: the gate is default-deny. The list of routes is DERIVED from the Hono route table (app.routes), never typed by hand, so a
// route added tomorrow is probed automatically and fails here unless it answers 401 signed out and the gate code while a gate is open.
// The only way out of default-deny is to be named in one of the three declared sets below.

const SAMPLE_ID = '00000000-0000-4000-8000-0000000000aa';

/** Reachable without a session: the health check and the endpoints that create or recover one. */
const PUBLIC = new Set([
  'GET /api/health',
  'POST /api/auth/login',
  'POST /api/auth/login/2fa',
  'POST /api/auth/setup',
  'POST /api/auth/recover',
  'POST /api/auth/forgot/verify',
  'POST /api/auth/forgot/complete'
]);
/** Answer 200 signed out and while a gate is open (the client asks them to decide which screen to show). */
const ALWAYS_OPEN = new Set(['GET /api/auth/session', 'POST /api/auth/logout']);
/** The endpoints that close each gate: the only others that answer while it is open. */
const GATE_ENDPOINTS: Record<string, Set<string>> = {
  password_change_required: new Set(['POST /api/auth/change-password']),
  key_setup_required: new Set(['POST /api/keys/setup', 'POST /api/auth/change-password', 'GET /api/keys/me']),
  two_factor_enrollment_required: new Set(['POST /api/auth/2fa/enroll/start', 'POST /api/auth/2fa/enroll/confirm'])
};

/** A user in each gate state; the first gate that applies wins, so each fixture satisfies the ones before it. */
const GATED_USERS: Record<string, () => ReturnType<typeof createUser>> = {
  password_change_required: () => createUser('gated@example.com', { mustChange: true }),
  key_setup_required: () => createUser('gated@example.com', { keys: false }),
  two_factor_enrollment_required: () => createUser('gated@example.com', { role: 'admin', totp: false })
};

const ALWAYS_OPEN_LAST = new Set(['POST /api/auth/logout']);

interface Route {
  label: string;
  method: string;
  path: string;
}

function routeTable(): Route[] {
  const found = new Map<string, Route>();
  for (const route of app.routes) {
    // `app.use(...)` middleware is registered as ALL; the handlers behind it are the routes.
    if (route.method === 'ALL' || !route.path.startsWith('/api/')) {
      continue;
    }
    const path = route.path.replaceAll(/:\w+/g, SAMPLE_ID);
    found.set(`${route.method} ${path}`, { label: `${route.method} ${route.path}`, method: route.method, path });
  }
  return [...found.values()];
}

const probe = (route: Route, cookie?: string) =>
  call(route.path, {
    method: route.method,
    cookie,
    body: route.method === 'GET' || route.method === 'DELETE' ? undefined : {},
    // The WebSocket route is probed the way a browser reaches it.
    headers: route.path === '/api/ws' ? { Upgrade: 'websocket', Origin: ORIGIN } : undefined
  });

const key = (route: Route): string => `${route.method} ${route.path.replaceAll(SAMPLE_ID, ':id')}`;
const declared = (route: Route): string => route.label.replaceAll(/:\w+/g, ':id');

describe('the route table', () => {
  it('is not empty and contains the routes every class of caller depends on', () => {
    const labels = routeTable().map(declared);
    expect(labels.length).toBeGreaterThanOrEqual(25);
    for (const expected of [
      'GET /api/messages',
      'POST /api/messages/send',
      'POST /api/messages/internal',
      'POST /api/messages/batch',
      'GET /api/ws',
      'POST /api/push/subscribe',
      'PUT /api/drafts/:id',
      'GET /api/attachments/:id',
      'GET /api/raw/:id',
      'POST /api/auth/change-password'
    ]) {
      expect(labels, expected).toContain(expected);
    }
  });

  it('declares only routes that exist (a removed route must leave the declared sets too)', () => {
    const labels = new Set(routeTable().map(declared));
    const stale = [...PUBLIC, ...ALWAYS_OPEN, ...Object.values(GATE_ENDPOINTS).flatMap((set) => [...set])].filter(
      (label) => !labels.has(label)
    );
    expect(stale).toEqual([]);
  });
});

describe('default-deny, signed out', () => {
  it('answers 401 on every route that is not declared public or always open', async () => {
    for (const route of routeTable()) {
      const answer = await probe(route);
      if (PUBLIC.has(key(route))) {
        expect([400, 200, 503], `${route.label} (public)`).toContain(answer.status);
      } else if (ALWAYS_OPEN.has(key(route))) {
        expect(answer.status, `${route.label} (always open)`).toBe(200);
      } else {
        expect(answer.status, route.label).toBe(401);
        expect(answer.json, route.label).toEqual({ success: false, error: 'Unauthorized', code: 'unauthorized' });
      }
    }
  }, 60_000);

  it('answers 401 for a path that has no route at all (the check runs before routing)', async () => {
    for (const path of ['/api/nothing-here', '/api/admin/nothing-here', '/api/auth/nothing-here']) {
      expect((await call(path)).status, path).toBe(401);
      expect((await call(path, { method: 'POST', body: {} })).status, path).toBe(401);
    }
  });
});

describe.each(Object.keys(GATED_USERS))('default-deny, while the gate %s is open', (gate) => {
  it('answers the gate code on every route outside the gate allow-list', async () => {
    const user = await GATED_USERS[gate]();
    const cookie = await signIn(user);
    expect((await call('/api/auth/session', { cookie })).json).toMatchObject({ authenticated: true, gate });
    // Signing out ends the session, so it is probed last.
    const routes = routeTable().toSorted((a, b) => Number(ALWAYS_OPEN_LAST.has(key(a))) - Number(ALWAYS_OPEN_LAST.has(key(b))));
    for (const route of routes) {
      const answer = await probe(route, cookie);
      const label = `${route.label} (gate ${gate})`;
      if (PUBLIC.has(key(route))) {
        expect(answer.status, label).not.toBe(403);
      } else if (ALWAYS_OPEN.has(key(route))) {
        expect(answer.status, label).toBe(200);
      } else if (GATE_ENDPOINTS[gate].has(key(route))) {
        // It reaches its handler (an empty body is a 400 from the handler, a read is a 200), not a 403 from the gate.
        expect([200, 400], label).toContain(answer.status);
      } else {
        expect(answer.status, label).toBe(403);
        expect(answer.json, label).toEqual({ success: false, error: gate, code: gate });
      }
    }
  }, 60_000);

  it('applies the gate to a path that has no route, and to /api/admin', async () => {
    const user = await GATED_USERS[gate]();
    const cookie = await signIn(user);
    for (const path of ['/api/nothing-here', '/api/admin/users']) {
      expect((await call(path, { cookie })).status, path).toBe(403);
    }
  });
});

describe('the gate order', () => {
  it('shows only the first gate that applies, and the next one when it is closed', async () => {
    // A temporary password, no keys (the key setup includes the recovery key), an admin without two-step verification: one gate at a time.
    const user = await createUser('order@example.com', { role: 'admin', totp: false, keys: false, mustChange: true });
    const cookie = await signIn(user);
    expect((await call('/api/stats', { cookie })).json).toMatchObject({ code: 'password_change_required' });
    await db().update(users).set({ must_change_password: 0 }).where(eq(users.id, user.id));
    expect((await call('/api/stats', { cookie })).json).toMatchObject({ code: 'key_setup_required' });
    await db()
      .update(users)
      .set({
        public_key: 'x',
        key_id: 'x',
        wrapped_private_key_pw: 'x',
        wrapped_private_key_recovery: 'x',
        recovery_verifier: 'x',
        recovery_salt: 'x',
        recovery_iterations: 1
      })
      .where(eq(users.id, user.id));
    expect((await call('/api/stats', { cookie })).json).toMatchObject({ code: 'two_factor_enrollment_required' });
    await db().update(users).set({ totp_enabled: 1 }).where(eq(users.id, user.id));
    expect((await call('/api/stats', { cookie })).status).toBe(200);
  });

  it('gates a member who is already signed in the moment the organisation requires two-step verification', async () => {
    const member = await createUser('member@example.com');
    const cookie = await signIn(member);
    expect((await call('/api/stats', { cookie })).status).toBe(200);
    await db().update(settings).set({ value: '1' }).where(eq(settings.key, 'require_2fa'));
    expect((await call('/api/stats', { cookie })).json).toMatchObject({ code: 'two_factor_enrollment_required' });
    await db().update(settings).set({ value: '0' }).where(eq(settings.key, 'require_2fa'));
    expect((await call('/api/stats', { cookie })).status).toBe(200);
  });
});

describe('the admin area', () => {
  it('refuses a member (403) and a signed-out caller (401) on everything under /api/admin', async () => {
    const member = await createUser('member@example.com');
    const cookie = await signIn(member);
    const adminRoutes = routeTable().filter((route) => route.path.startsWith('/api/admin/'));
    for (const route of [...adminRoutes, { label: 'GET /api/admin/probe', method: 'GET', path: '/api/admin/probe' }]) {
      expect((await probe(route, cookie)).status, route.label).toBe(403);
      expect((await probe(route)).status, route.label).toBe(401);
    }
  });
});
