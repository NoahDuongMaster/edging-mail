// Which screen the signed-out part of the app opens on next. Normally sign-in; the unlock screen's 'Forgot password' signs the person out
// and asks for the forgotten-password flow instead, with their address filled in (J4-16): the signed-out screens mount fresh after the
// sign-out, so the wish waits here, in memory, until they have read it.

export interface SignedOutStart {
  view: 'forgot';
  email: string;
}

let next: SignedOutStart | null = null;

/** The next signed-out screen is the forgotten-password flow for `email` (read once by AuthGate). */
export function openForgotNext(email: string): void {
  next = { view: 'forgot', email };
}

/** What the signed-out screens open on (does not clear it: StrictMode renders twice). */
export function signedOutStart(): SignedOutStart | null {
  return next;
}

/** The wish was used (called after the signed-out screens mounted). */
export function clearSignedOutStart(): void {
  next = null;
}
