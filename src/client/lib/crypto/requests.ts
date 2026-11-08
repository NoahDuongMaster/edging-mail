import { KDF_VERSION } from '../../../shared/crypto/constants';
import type { KeySet } from '../../../shared/crypto/client';
import type { Locale } from '../../../shared/i18n/languages';

// The body of every request that carries a credential, built in ONE place. A builder takes only what may go on the wire: `auth` values
// (what a password was turned into), codes, wrapped keys and public keys. It has no parameter for a password, a recovery key, `rwk`, `wk`
// or a private key, so none of them can be put in a body by a slip, and test/client/requests.test.ts checks the shape of each one and scans
// every body for the canary secrets (crypto-design.md 15.10).

export type KeyUpload = KeySet['upload'];

/** A second factor: the six digits of the authenticator app, or one single-use recovery code. */
export type SecondFactor = { code: string } | { recovery_code: string };

type Kdf = typeof KDF_VERSION;

interface LoginBody {
  email: string;
  auth: string;
  kdf: Kdf;
  /** Present (true) only when the person ticked "shared or public device": the Worker then issues a session that ends with the browser and lives a short time (CK-17). */
  shared?: true;
}

export const loginBody = (email: string, auth: string, shared = false): LoginBody => ({
  email,
  auth,
  kdf: KDF_VERSION,
  ...(shared ? { shared: true as const } : {})
});

export const secondStepBody = (challenge: string, factor: SecondFactor): { challenge: string } & SecondFactor => ({ challenge, ...factor });

interface FirstPasswordBody {
  current_auth: string;
  new_auth: string;
  kdf: Kdf;
  keys: KeyUpload;
  keys_version: number;
  admin_strength: boolean;
}

/** First sign-in with a temporary password: the new password, the first key set and the recovery key's proof, in ONE request. */
export const firstPasswordBody = (currentAuth: string, newAuth: string, keys: KeyUpload, adminStrength: boolean): FirstPasswordBody => ({
  current_auth: currentAuth,
  new_auth: newAuth,
  kdf: KDF_VERSION,
  keys,
  keys_version: 0,
  admin_strength: adminStrength
});

interface ChangePasswordBody {
  current_auth: string;
  new_auth: string;
  kdf: Kdf;
  keys: { wrapped_private_key_pw: string };
  keys_version: number;
  admin_strength: boolean;
}

/** A password change for an account that has keys: the private key re-wrapped under the new password, compare-and-set on `keys_version`. */
export const changePasswordBody = (
  currentAuth: string,
  newAuth: string,
  wrappedPrivateKeyPw: string,
  keysVersion: number,
  adminStrength: boolean
): ChangePasswordBody => ({
  current_auth: currentAuth,
  new_auth: newAuth,
  kdf: KDF_VERSION,
  keys: { wrapped_private_key_pw: wrappedPrivateKeyPw },
  keys_version: keysVersion,
  admin_strength: adminStrength
});

/** The first keys of an account that chose its own password but has none (key setup gate). */
export const keySetupBody = (currentAuth: string, keys: KeyUpload): { current_auth: string; keys: KeyUpload; keys_version: number } => ({
  current_auth: currentAuth,
  keys,
  keys_version: 0
});

interface NewRecoveryKeyBody {
  current_auth: string;
  wrapped_private_key_recovery: string;
  recovery_auth: string;
  keys_version: number;
}

/** "Create a new recovery key": replaces the recovery wrap and the recovery verifier. */
export const newRecoveryKeyBody = (
  currentAuth: string,
  wrappedPrivateKeyRecovery: string,
  recoveryAuth: string,
  keysVersion: number
): NewRecoveryKeyBody => ({
  current_auth: currentAuth,
  wrapped_private_key_recovery: wrappedPrivateKeyRecovery,
  recovery_auth: recoveryAuth,
  keys_version: keysVersion
});

type ForgotVerifyBody = { email: string; recovery_auth: string; kdf: Kdf } & Partial<{ code: string; recovery_code: string }>;

export const forgotVerifyBody = (email: string, recoveryAuth: string, factor: SecondFactor | null): ForgotVerifyBody => ({
  email,
  recovery_auth: recoveryAuth,
  kdf: KDF_VERSION,
  ...factor
});

interface ForgotCompleteBody {
  ticket: string;
  new_auth: string;
  kdf: Kdf;
  wrapped_private_key_pw: string;
  wrapped_private_key_recovery: string;
  recovery_auth: string;
}

export const forgotCompleteBody = (
  ticket: string,
  newAuth: string,
  wrappedPrivateKeyPw: string,
  wrappedPrivateKeyRecovery: string,
  recoveryAuth: string
): ForgotCompleteBody => ({
  ticket,
  new_auth: newAuth,
  kdf: KDF_VERSION,
  wrapped_private_key_pw: wrappedPrivateKeyPw,
  wrapped_private_key_recovery: wrappedPrivateKeyRecovery,
  recovery_auth: recoveryAuth
});

export interface SetupFields {
  setupKey: string;
  email: string;
  displayName: string;
  language: Locale;
}

interface SetupBody {
  setup_key: string;
  email: string;
  display_name: string;
  auth: string;
  kdf: Kdf;
  keys: KeyUpload;
  language: SetupFields['language'];
}

/** First-run Setup: the setup key (a deployment secret the operator holds), the admin's address, `auth` of their password and their first keys. */
export const setupBody = (fields: SetupFields, auth: string, keys: KeyUpload): SetupBody => ({
  setup_key: fields.setupKey,
  email: fields.email,
  display_name: fields.displayName,
  auth,
  kdf: KDF_VERSION,
  keys,
  language: fields.language
});

interface BreakGlassBody {
  setup_key: string;
  email: string;
  new_auth: string;
  kdf: Kdf;
  keys: KeyUpload;
}

/** Break-glass for an admin who lost both password and recovery key: a NEW key pair and a NEW recovery key, with the setup key. */
export const breakGlassBody = (setupKey: string, email: string, newAuth: string, keys: KeyUpload): BreakGlassBody => ({
  setup_key: setupKey,
  email,
  new_auth: newAuth,
  kdf: KDF_VERSION,
  keys
});

export const enrollStartBody = (currentAuth: string): { current_auth: string } => ({ current_auth: currentAuth });

/** Confirm an enrolment, disable two-factor, or make new recovery codes: all take the password's `auth` and one six-digit code. */
export const twoFactorBody = (currentAuth: string, code: string): { current_auth: string; code: string } => ({
  current_auth: currentAuth,
  code
});

export const stepUpBody = (code: string): { code: string } => ({ code });

/** Ask to delete the mail locked under one retired key: the password's `auth` and the key's id. Nothing is deleted at once, the server waits first. */
export const lockedDeleteBody = (currentAuth: string, keyId: string): { current_auth: string; key_id: string } => ({
  current_auth: currentAuth,
  key_id: keyId
});

/** Cancel a pending deletion of locked mail: the session is enough, so there is no credential in this body. */
export const lockedCancelBody = (keyId: string): { key_id: string } => ({ key_id: keyId });

/** Sign-out: empty, or the endpoint of this browser's push subscription so the Worker deletes that one subscription with the sessions (CK-16). Not a secret. */
export const logoutBody = (pushEndpoint: string | null): { push_endpoint?: string } =>
  pushEndpoint === null || pushEndpoint === '' ? {} : { push_endpoint: pushEndpoint };
