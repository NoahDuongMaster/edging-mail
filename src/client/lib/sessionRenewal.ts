// Some requests make the Worker end EVERY session of the person and, in the same answer, issue the caller a new cookie: change password, new
// recovery codes, two-factor turned on or off. The private key does not change (at most its wrap does), so the session of THIS device carries on
// and keeps its key. What comes with the change looks like a lost session (the open sockets close, a request that went out with the old cookie
// answers 401), and it is not one while the request runs and for a few seconds after it succeeded. During that time those signs only make the
// app ask the session check; the check is the authority, and a real loss (the check answers "signed out") still wipes the key.

/** The close code of the Worker's socket for "your sessions were renewed": the cookie of this person changed, reconnect (src/worker/realtime.ts). */
export const SESSION_RENEWED_CLOSE = 4402;

/** The requests that renew the caller's session. */
export const RENEWAL_PATHS: ReadonlySet<string> = new Set([
  '/api/auth/change-password',
  '/api/auth/2fa/enroll/confirm',
  '/api/auth/2fa/disable',
  '/api/auth/2fa/recovery-codes'
]);

/** After a success the new cookie is in the browser; requests and sockets that started before it may still fail for this long. */
const GRACE_MS = 5000;
const POLL_MS = 500;

let running = 0;
let graceUntil = 0;

/** Runs `request` (one that renews the session) and counts it as a renewal while it runs and for a few seconds after it succeeded. */
export async function renewing<T>(request: () => Promise<T>): Promise<T> {
  running += 1;
  try {
    const result = await request();
    graceUntil = Date.now() + GRACE_MS;
    return result;
  } finally {
    running -= 1;
  }
}

export const renewalInProgress = (): boolean => running > 0 || Date.now() < graceUntil;

/** Calls `callback` once no renewal is running or waiting out its grace time. */
export function whenRenewalEnds(callback: () => void): void {
  const check = () => {
    if (renewalInProgress()) {
      setTimeout(check, POLL_MS);
    } else {
      callback();
    }
  };
  setTimeout(check, POLL_MS);
}

/** The close code of the Worker's socket for a session that ended (sign-out elsewhere, a reset, an admin's change). */
export const AUTH_FAILURE_CLOSE = 4401;

/** What a closed socket asks of the app: nothing, the session check, or the keys wiped first and then the check. */
export type CloseResponse = 'none' | 'check' | 'wipe_and_check';

/**
 * A 4401 means the session ended: no key may outlive it (CK-13). A 4402 means the person's sessions were renewed, by this device or another:
 * the session check says whether THIS device still has a good cookie. While this device is itself renewing its session (a password change,
 * new recovery codes) both are only a reason to ask the check, never to wipe.
 */
export function responseToClose(code: number, ownRenewal: boolean): CloseResponse {
  if (code === SESSION_RENEWED_CLOSE) {
    return 'check';
  }
  if (code === AUTH_FAILURE_CLOSE) {
    return ownRenewal ? 'check' : 'wipe_and_check';
  }
  return 'none';
}

/** What the app does when the Worker closes the person's socket with `code`. The check is asked after a renewal of this device has ended. */
export function handleSocketClose(code: number, actions: { wipeKeys: () => void; checkSession: () => void }): void {
  const ownRenewal = renewalInProgress();
  const response = responseToClose(code, ownRenewal);
  if (response === 'wipe_and_check') {
    actions.wipeKeys();
  }
  if (response === 'none') {
    return;
  }
  if (ownRenewal) {
    // The new cookie must be in place before the check looks.
    whenRenewalEnds(actions.checkSession);
  } else {
    actions.checkSession();
  }
}

/** SR-1: how long the app keeps asking the session check when the check itself cannot be answered (offline, a 5xx), before it locks. */
export const SESSION_CHECK_PATIENCE_MS = 30_000;
const SESSION_CHECK_RETRY_MS = 3000;

let confirming: Promise<void> | null = null;

/**
 * The session check after a sign that the session may be gone (a 4401 or 4402 close, a 401 inside a renewal): the check is the authority, and a
 * check that cannot be answered is not "fine". `check` asks it and returns true when the server ANSWERED (whatever it said; "signed out" wipes
 * the keys by itself), false when the question failed. A failed check is asked again every few seconds for 30 seconds; if it still cannot be
 * answered by then the keys are wiped and the app locks, so a device whose session was revoked and which went offline right after cannot keep its
 * key for as long as it stays offline (SR-1). One round at a time: a second call while one runs joins it.
 */
export function confirmSession(check: () => Promise<boolean>, wipeKeys: () => void): Promise<void> {
  confirming ??= (async () => {
    const started = Date.now();
    try {
      while (!(await check())) {
        if (Date.now() - started >= SESSION_CHECK_PATIENCE_MS) {
          wipeKeys();
          return;
        }
        await new Promise<void>((resolve) => {
          setTimeout(resolve, SESSION_CHECK_RETRY_MS);
        });
      }
    } finally {
      confirming = null;
    }
  })();
  return confirming;
}

/** Tests only: forgets any renewal and any check in progress. */
export function resetRenewal(): void {
  running = 0;
  graceUntil = 0;
  confirming = null;
}
