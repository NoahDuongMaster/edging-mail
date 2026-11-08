import { deriveCredentials } from '../../../shared/crypto/client';
import { apiPost } from '../api';
import type { GateCode, SessionUser } from '../auth';
import { dropGateCredentials, holdGateCredentials } from './gateCredentials';
import { loginBody, secondStepBody } from './requests';
import type { SecondFactor } from './requests';
import { rememberSharedDevice } from './sharedDevice';
import { unlockWithWrapKey } from './unlock';
import type { KeyBundle } from './unlock';

// The sign-in, step by step (crypto-design.md 15.4). The password is turned into `auth` and the wrap key in one derivation, right here;
// the password itself goes no further than the screen's input. While a second factor is pending, `auth` and the wrap key wait in this
// module (not in React state), and `abandonSignIn` drops them.

interface SignInAnswer {
  user: SessionUser;
  keys?: KeyBundle;
  gate?: GateCode;
  two_factor_required?: boolean;
  challenge?: string;
}

export type SignInOutcome =
  { kind: 'second_factor'; challenge: string } | { kind: 'signed_in'; user: SessionUser; gate: GateCode | null; keysOpened: boolean };

interface Pending {
  email: string;
  auth: string;
  wrapKey: CryptoKey;
  persist: boolean;
}

let pending: Pending | null = null;

export function abandonSignIn(): void {
  pending = null;
}

/** What follows a successful answer: the keys are opened when the account has some, and what a gate still needs is kept for the gate screens. */
async function finish(answer: SignInAnswer, held: Pending): Promise<SignInOutcome> {
  const gate = answer.gate ?? null;
  let keysOpened = false;
  if (answer.keys !== undefined) {
    try {
      await unlockWithWrapKey(held.wrapKey, answer.user, answer.keys, { persist: held.persist });
      keysOpened = true;
    } catch {
      // The password was right but its keys do not open: the unlock screen takes over and says so (a person is never stuck on this step).
    }
  }
  if (gate === null) {
    dropGateCredentials();
  } else {
    holdGateCredentials({ email: held.email, auth: held.auth, wrapKey: held.wrapKey, persist: held.persist });
  }
  pending = null;
  // Remembered for this tab: after a reload the unlock screen starts with the same choice (sharedDevice.ts).
  rememberSharedDevice(!held.persist);
  return { kind: 'signed_in', user: answer.user, gate, keysOpened };
}

/** Step 1: address and password. Resolves with the second-factor step when the account has one, else with the signed-in person. */
export async function startSignIn(email: string, password: string, options: { shared: boolean }): Promise<SignInOutcome> {
  const { auth, wrapKey } = await deriveCredentials(password, email);
  const held: Pending = { email: email.trim().toLowerCase(), auth, wrapKey, persist: !options.shared };
  const answer = await apiPost<SignInAnswer>('/api/auth/login', loginBody(held.email, auth, options.shared), 'fail.sign_in');
  if (answer.two_factor_required === true && typeof answer.challenge === 'string') {
    pending = held;
    return { kind: 'second_factor', challenge: answer.challenge };
  }
  return finish(answer, held);
}

/** Step 2: the code of the authenticator app, or one recovery code. A wrong code leaves the step open (the challenge allows five tries). */
export async function finishSecondFactor(challenge: string, factor: SecondFactor): Promise<SignInOutcome> {
  if (pending === null) {
    throw new Error('no sign-in is waiting for a second factor');
  }
  const held = pending;
  const answer = await apiPost<SignInAnswer>('/api/auth/login/2fa', secondStepBody(challenge, factor), 'fail.sign_in');
  return finish(answer, held);
}
