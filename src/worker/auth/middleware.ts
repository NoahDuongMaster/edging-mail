import type { MiddlewareHandler } from 'hono';
import type { AppEnv, SessionUser } from '../types';
import { apiError } from '../errors';
import { verifiedUser } from './session';

// Gates: states in which a signed-in account may do ONE thing and nothing else. The first gate that applies wins, and while it is open
// only its own endpoints, GET /api/auth/session and POST /api/auth/logout answer; every other /api route answers
// 403 { success: false, error: <code>, code: <code> }. Evaluated on every request from the database row, so a gate that opens
// (a reset, a policy change) reaches sessions that are already signed in. The client routes on the code.
// Order (crypto-design.md 15.4): password -> key setup (the keys AND the mandatory recovery key arrive in one request) -> two-step enrollment
// (a member under the policy never reaches the mailbox before enrolling).
interface Gate {
  code: string;
  applies: (user: SessionUser) => boolean;
  /** "METHOD /api/path" of the endpoints that close the gate. */
  endpoints: string[];
}

const GATES: Gate[] = [
  { code: 'password_change_required', applies: (user) => user.must_change_password, endpoints: ['POST /api/auth/change-password'] },
  // No key pair yet. The setup stores the keys, the recovery wrap and the recovery verifier together, so there is no gate of its own for the
  // recovery key. The first sign-in with a temporary password can do both steps in the one change-password request.
  {
    code: 'key_setup_required',
    applies: (user) => !user.has_keys,
    endpoints: ['POST /api/keys/setup', 'POST /api/auth/change-password', 'GET /api/keys/me']
  },
  // Admins always, members when the organisation requires it. Evaluated per request: switching the policy on gates sessions already open.
  {
    code: 'two_factor_enrollment_required',
    applies: (user) => !user.totp_enabled && (user.role === 'admin' || user.require_2fa),
    endpoints: ['POST /api/auth/2fa/enroll/start', 'POST /api/auth/2fa/enroll/confirm']
  }
];

const ALWAYS_OPEN = new Set(['GET /api/auth/session', 'POST /api/auth/logout']);

/** The code of the gate that is open for this account, if any. */
export const openGate = (user: SessionUser): Gate | undefined => GATES.find((gate) => gate.applies(user));

// Reachable without a session: the health check and the endpoints that create one (or recover one).
const PUBLIC = new Set([
  '/api/health',
  '/api/auth/login',
  '/api/auth/login/2fa',
  '/api/auth/setup',
  '/api/auth/recover',
  '/api/auth/forgot/verify',
  '/api/auth/forgot/complete'
]);
// These work signed out too (the answer says so); they get the user when there is one.
const OPTIONAL = new Set(['/api/auth/session', '/api/auth/logout']);

/**
 * Registered above every route so that a route added later is private by default: puts `user` on the context, answers 401 without a
 * real session (see verifiedUser) and 403 while a gate is open. The `/api/admin` role check is `requireAdmin`.
 */
export const authenticate: MiddlewareHandler<AppEnv> = async (c, next) => {
  const path = c.req.path;
  if (PUBLIC.has(path)) {
    c.set('user', null);
    await next();
    return;
  }
  const user = await verifiedUser(c.req.raw, c.env);
  c.set('user', user);
  if (user === null) {
    if (OPTIONAL.has(path)) {
      await next();
      return;
    }
    return apiError(c, 'unauthorized');
  }
  const gate = openGate(user);
  if (gate !== undefined && !ALWAYS_OPEN.has(`${c.req.method} ${path}`) && !gate.endpoints.includes(`${c.req.method} ${path}`)) {
    return c.json({ success: false, error: gate.code, code: gate.code }, 403);
  }
  await next();
};

/**
 * The console: an admin, with two-step verification (the gate already holds an admin without it), and not a newly promoted member who
 * has yet to set an admin-length password.
 */
export const requireAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
  const user = c.get('user');
  if (user?.role !== 'admin') {
    return apiError(c, 'admin_required');
  }
  if (user.admin_password_upgrade_required) {
    return apiError(c, 'admin_password_upgrade_required');
  }
  await next();
};

/** Step-up: a second-factor check within the last five minutes (a 2FA sign-in counts). For the actions that change who can do what. */
export const STEP_UP_WINDOW_MS = 5 * 60_000;
export const hasStepUp = (user: SessionUser): boolean => user.step_up_at > Date.now() - STEP_UP_WINDOW_MS;
export const requireStepUp: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!hasStepUp(currentUser(c))) {
    return apiError(c, 'step_up_required');
  }
  await next();
};

/** The signed-in account of a route that sits behind `authenticate`. */
export function currentUser(c: { get: (key: 'user') => SessionUser | null }): SessionUser {
  const user = c.get('user');
  if (user === null) {
    // Unreachable: `authenticate` answers 401 first. Fail closed if a route is ever mounted outside it.
    throw new Error('No signed-in user on a protected route');
  }
  return user;
}
