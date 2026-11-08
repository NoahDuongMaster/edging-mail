import { deriveCredentials } from '../../../shared/crypto/client';
import { apiPost } from '../api';
import type { SessionUser } from '../auth';
import { passwordLength, ADMIN_MIN_LENGTH } from '../password/policy';
import { holdGateCredentials } from './gateCredentials';
import type { GateCredentials } from './gateCredentials';
import { keepKey } from './keyStore';
import { enrollStartBody, firstPasswordBody, keySetupBody, twoFactorBody } from './requests';
import { rememberSharedDevice } from './sharedDevice';
import type { RecoveryKeyDraft } from './recoveryDraft';
import type { KeyBundle } from './unlock';

// The three gates of a first sign-in, in the order a person meets them (crypto-design.md 15.4): choose a password (together with the first
// keys and the recovery key, in ONE request), set up keys (an account that has its own password but no keys), enrol two-factor.
// Each call repeats `current_auth`, which the sign-in kept as `auth` (gateCredentials.ts); when the page was reloaded in the middle of a gate
// that is gone, and the screen asks for the current password once (`gateCredentialsFromPassword`).

/** The current password turned into what the gate requests need, when the sign-in's own copy is gone. The password is not kept. */
export async function gateCredentialsFromPassword(email: string, password: string, persist: boolean): Promise<GateCredentials> {
  const { auth, wrapKey } = await deriveCredentials(password, email);
  const credentials: GateCredentials = { email: email.trim().toLowerCase(), auth, wrapKey, persist };
  holdGateCredentials(credentials);
  rememberSharedDevice(!persist);
  return credentials;
}

interface KeysAnswer {
  user: SessionUser;
  keys: KeyBundle;
}

/**
 * Gate 1 on a first sign-in with a temporary password: the new password, the first key pair (wrapped under the new password and under the
 * new recovery key) and the recovery key's proof, in one atomic request. The recovery key was shown and confirmed BEFORE this call.
 */
export async function completeFirstPassword(
  credentials: GateCredentials,
  newPassword: string,
  draft: RecoveryKeyDraft
): Promise<SessionUser> {
  const next = await deriveCredentials(newPassword, credentials.email);
  const keySet = await draft.keySet(next.wrapKey, credentials.email);
  const answer = await apiPost<KeysAnswer>(
    '/api/auth/change-password',
    firstPasswordBody(credentials.auth, next.auth, keySet.upload, passwordLength(newPassword) >= ADMIN_MIN_LENGTH),
    'fail.password_change'
  );
  // The password just chosen is now the credential the next gate repeats; the key it made is the one in use.
  holdGateCredentials({ email: credentials.email, auth: next.auth, wrapKey: next.wrapKey, persist: credentials.persist });
  await keepKey(answer.user.id, keySet.pair, keySet.publicKey, { persist: credentials.persist });
  return answer.user;
}

/** Gate 2 for an account that chose its own password but has no keys: the first keys and the recovery key, in one request. */
export async function completeKeySetup(credentials: GateCredentials, userId: string, draft: RecoveryKeyDraft): Promise<void> {
  const keySet = await draft.keySet(credentials.wrapKey, credentials.email);
  await apiPost('/api/keys/setup', keySetupBody(credentials.auth, keySet.upload), 'fail.keys_setup');
  await keepKey(userId, keySet.pair, keySet.publicKey, { persist: credentials.persist });
}

/** What Gate 3 shows: the secret to enter into an authenticator app, in both forms. */
export interface EnrolmentStart {
  secret_base32: string;
  otpauth_uri: string;
}

export const startEnrolment = (credentials: GateCredentials): Promise<EnrolmentStart> =>
  apiPost<EnrolmentStart>('/api/auth/2fa/enroll/start', enrollStartBody(credentials.auth), 'fail.two_factor_enrol');

/** The answer of a confirmed enrolment: the single-use recovery codes, shown once. */
export interface EnrolmentDone {
  recovery_codes: string[];
  user: SessionUser;
}

export async function confirmEnrolment(credentials: GateCredentials, code: string): Promise<EnrolmentDone> {
  return apiPost<EnrolmentDone>('/api/auth/2fa/enroll/confirm', twoFactorBody(credentials.auth, code), 'fail.two_factor_enrol');
}

/** The gates are done: nothing of the sign-in is kept. */
export { dropGateCredentials as finishGates } from './gateCredentials';
