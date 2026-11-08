import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
  type UseMutationResult,
  type UseQueryResult
} from '@tanstack/react-query';
import { apiGet, apiPost } from './api';
import { wipeKeys, wipeKeysInBackground } from './crypto/keyStore';
import { logoutBody } from './crypto/requests';
import { tr } from './i18n';

/** The account as the server describes the signed-in person (`SessionUser` of the Worker). */
export interface SessionUser {
  id: string;
  email: string;
  display_name: string;
  role: 'member' | 'admin';
  /** Still on the temporary password an admin made. */
  must_change_password: boolean;
  /** Has a key pair. False until the first sign-in's key setup is done. */
  has_keys: boolean;
  totp_enabled: boolean;
  /** The organisation requires two-factor sign-in of members too (admins always need it). */
  require_2fa: boolean;
  /** When an admin's reset of THIS admin's two-factor sign-in takes effect (null = none pending). */
  two_factor_reset_due_at: number | null;
  admin_password_upgrade_required: boolean;
  /** Epoch ms of the last second-factor check of this session (0 = none). */
  step_up_at: number;
}

/** The gate that is open for a signed-in account, in the order a person meets them. */
export type GateCode = 'password_change_required' | 'key_setup_required' | 'two_factor_enrollment_required';

export interface Session {
  authenticated: boolean;
  /** Who is signed in, when the server says (it always does for a signed-in person). */
  user?: SessionUser;
  /** The one thing a signed-in account may do until it is done (choose a password, set up keys, enrol two-factor). */
  gate?: GateCode | null;
  /** This session was started on a shared or public device (the server read it from the session cookie): its keys never go to storage. */
  shared?: boolean;
  /** The signed-in person's saved language (null until they choose one), and the organisation default (public, also signed out). */
  language?: string | null;
  default_language?: string | null;
  /** Signed out only: nobody has set the app up yet, and what the Setup screen needs to know. */
  setup_required?: boolean;
  configured?: boolean;
  missing_secrets?: string[];
  default_from?: string;
  default_display_name?: string;
}

export const sessionKey = ['session'] as const;

/**
 * Flips the session to signed out (App then shows the login screen), wipes the keys (memory and every stored copy) and drops every cached
 * mail, setting and push status so nothing from the old session stays in memory. The session entry itself is kept:
 * `queryClient.clear()` would detach App's session observer, so the screen would never update.
 */
export function endSession(queryClient: QueryClient): void {
  wipeKeysInBackground();
  queryClient.setQueryData<Session>(sessionKey, { authenticated: false });
  queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== sessionKey[0] });
}

/**
 * The gate that applies to an account, worked out the way the Worker does (src/worker/auth/middleware.ts, same order): used right after a
 * step of the first sign-in so the next screen shows at once. The server's `gate` in the session answer stays the authority.
 */
export function gateOfUser(user: SessionUser): GateCode | null {
  if (user.must_change_password) {
    return 'password_change_required';
  }
  if (!user.has_keys) {
    return 'key_setup_required';
  }
  return !user.totp_enabled && (user.role === 'admin' || user.require_2fa) ? 'two_factor_enrollment_required' : null;
}

/** The server accepted a sign-in or a gate step: the session now says who is signed in and which gate is open, without waiting for a re-read. */
export function applySignedIn(queryClient: QueryClient, user: SessionUser, gate: GateCode | null = gateOfUser(user)): void {
  queryClient.setQueryData<Session>(sessionKey, (old) => ({ ...old, authenticated: true, user, gate }));
  void queryClient.invalidateQueries({ queryKey: sessionKey });
}

export function useSession(): UseQueryResult<Session> {
  return useQuery({
    queryKey: sessionKey,
    queryFn: async ({ signal }) => {
      const data = await apiGet<Session>('/api/auth/session', 'fail.session_check', signal);
      if (!data.authenticated) {
        // The session probe says nobody is signed in: no key may outlive that (CK-13).
        wipeKeysInBackground();
      }
      return {
        authenticated: data.authenticated,
        user: data.user,
        gate: data.gate ?? null,
        shared: data.shared === true,
        language: data.language ?? null,
        default_language: data.default_language ?? null,
        setup_required: data.setup_required === true,
        configured: data.configured !== false,
        missing_secrets: data.missing_secrets ?? [],
        default_from: data.default_from,
        default_display_name: data.default_display_name
      };
    },
    // A cookie that expires later shows up as a 401 on some API call, which ends the session (main.tsx).
    staleTime: Infinity,
    // Until the first answer arrives (server down, started offline) the check tries again by itself every 5 s.
    refetchInterval: (query) => (query.state.data === undefined ? 5000 : false)
  });
}

/**
 * Reads the session again. True when the server answered (whatever it said: a "signed out" answer wipes the keys in `useSession`), false when the
 * question itself failed (offline, a 5xx): then nothing is known (SR-1, `confirmSession`).
 */
export async function askSession(queryClient: QueryClient): Promise<boolean> {
  await queryClient.invalidateQueries({ queryKey: sessionKey });
  return queryClient.getQueryState(sessionKey)?.status !== 'error';
}

/** True for a signed-in admin. False while the session loads, so the admin console is never offered on a guess. */
export function useIsAdmin(): boolean {
  return useSession().data?.user?.role === 'admin';
}

/** The text for a request that never reached the server, in the UI language. */
export const cannotReachServer = (): string => tr('err.network');

// `fetch` rejects with a TypeError ('Failed to fetch', 'Load failed', ...) when the server cannot be reached at all.
async function humanizeNetworkError<T>(request: Promise<T>): Promise<T> {
  try {
    return await request;
  } catch (error) {
    throw error instanceof TypeError ? new Error(cannotReachServer()) : error;
  }
}

/** The most a best-effort step of the sign-out may take: the push service can hang, and a sign-out must not. */
const BEST_EFFORT_CAP_MS = 8000;

/** Runs a step that must never stop or delay the sign-out for long: its answer, or null when it failed, rejected or ran past the cap. */
async function bestEffort<T>(step: () => Promise<T>): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cap = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      resolve(null);
    }, BEST_EFFORT_CAP_MS);
  });
  try {
    return await Promise.race([step(), cap]);
  } catch {
    // Best effort: the logout request ends the session whatever happened here.
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * What a sign-out does with this browser's push subscription (CK-16). The endpoint goes WITH the logout request and the Worker deletes that one
 * subscription in the same batch that ends the sessions, so a device that cannot reach the push service is not left behind; the browser's own
 * unsubscribe comes after the answer (it needs no session).
 */
export interface SignOutPush {
  /** The endpoint of this browser's push subscription, or null when it has none. */
  endpoint: () => Promise<string | null>;
  /** The browser's own unsubscribe, once the logout request has answered. */
  drop: () => Promise<unknown>;
}

/**
 * The request half of sign-out. The keys on this device (memory and every stored copy) are wiped FIRST and whatever comes after (a refusal, a
 * network error, a hung server, a push service that cannot be reached) cannot undo or skip that: a failed sign-out may leave the session alive
 * on the server, but never leaves a usable key behind (security review CAT-3, CK-13, CK-16).
 *
 * Then the push subscription of this browser is looked up (best effort, capped: it never blocks the sign-out for long and never stops it), its
 * endpoint travels with the logout request, and only after the Worker answered is the subscription dropped in the browser. A failed logout keeps
 * the subscription: the person may still be signed in.
 */
export async function signOutRequest(push?: SignOutPush): Promise<void> {
  try {
    await wipeKeys();
  } finally {
    const endpoint = push === undefined ? null : await bestEffort(push.endpoint);
    await humanizeNetworkError(apiPost('/api/auth/logout', logoutBody(endpoint), 'fail.sign_out'));
    if (push !== undefined && endpoint !== null) {
      await bestEffort(push.drop);
    }
  }
}

/** What a caller of the sign-out may add: this browser's push subscription (see `signOutRequest`). */
export interface LogoutOptions {
  push?: SignOutPush;
}

/**
 * Sign-out: wipes the keys, ends every session of the person on the server, then clears the caches here. When the request fails the person
 * may still be signed in on the server: the failure is shown and, with no key on this device, the app asks for the password again.
 */
export function useLogout(options: LogoutOptions = {}): UseMutationResult<unknown, Error, void> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => signOutRequest(options.push),
    onSuccess: () => endSession(queryClient)
  });
}
