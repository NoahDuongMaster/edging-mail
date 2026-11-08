import {
  assertKeyPair,
  decodeRecoveryKey,
  deriveCredentials,
  fromBase64Url,
  parsePublicKey,
  recoveryWrapKey,
  toBase64Url,
  unwrapPrivateKey,
  wrapPrivateKey
} from '../../../shared/crypto/client';
import { apiPost } from '../api';
import type { SessionUser } from '../auth';
import { ADMIN_MIN_LENGTH, passwordLength } from '../password/policy';
import { KeysOpenError } from './errors';
import { changePasswordBody, lockedDeleteBody, newRecoveryKeyBody, stepUpBody, twoFactorBody } from './requests';
import { fetchMyKeys } from './unlock';
import type { KeyBundle } from './unlock';
import type { RecoveryKeyDraft } from './recoveryDraft';

// What a signed-in person does with their own credentials in Settings > Account (crypto-design.md 15.3 to 15.6). Every function takes the
// password for the duration of the call only: it is turned into `auth` and a wrap key, used and dropped; nothing is stored here.

async function myBundle(): Promise<KeyBundle> {
  const { keys } = await fetchMyKeys();
  if (keys === null) {
    throw new KeysOpenError();
  }
  return keys;
}

/** The private key as an extractable key (it exists in this function and the one that called it, and is not stored), opened with the password. */
async function openWithPassword(user: Pick<SessionUser, 'email'>, password: string, bundle: KeyBundle) {
  const credentials = await deriveCredentials(password, user.email);
  try {
    const publicKey = await parsePublicKey(fromBase64Url(bundle.public_key));
    const privateKey = await unwrapPrivateKey(
      credentials.wrapKey,
      fromBase64Url(bundle.wrapped_private_key_pw),
      user.email,
      bundle.key_id,
      true
    );
    await assertKeyPair(privateKey, publicKey);
    return { credentials, privateKey, publicKey };
  } catch {
    throw new KeysOpenError();
  }
}

/**
 * "Test my recovery key": reads the typed key (typos are reported before anything else), then tries to open the stored recovery wrap with it,
 * here, in the browser. Nothing is sent and nothing changes. Returns false when the key is well formed but does not open the wrap.
 */
export async function testRecoveryKey(user: Pick<SessionUser, 'email'>, typed: string): Promise<boolean> {
  const recoveryKey = await decodeRecoveryKey(typed);
  try {
    // Reading the keys is outside the "is it the right key" try: no connection is an error to show, not a wrong key.
    const bundle = await myBundle();
    try {
      if (bundle.wrapped_private_key_recovery === undefined) {
        return false;
      }
      const publicKey = await parsePublicKey(fromBase64Url(bundle.public_key));
      const privateKey = await unwrapPrivateKey(
        await recoveryWrapKey(recoveryKey),
        fromBase64Url(bundle.wrapped_private_key_recovery),
        user.email,
        bundle.key_id
      );
      await assertKeyPair(privateKey, publicKey);
      return true;
    } catch {
      return false;
    }
  } finally {
    recoveryKey.fill(0);
  }
}

/**
 * Change password: the private key is opened with the current password and wrapped again under the new one (so the mail stays readable), and
 * the server checks the current password and ends every other session. This is not a key rotation: the key pair and the recovery key stay.
 */
export async function changePassword(user: Pick<SessionUser, 'email'>, currentPassword: string, newPassword: string): Promise<void> {
  const bundle = await myBundle();
  const { credentials, privateKey, publicKey } = await openWithPassword(user, currentPassword, bundle);
  const next = await deriveCredentials(newPassword, user.email);
  const wrapped = await wrapPrivateKey(next.wrapKey, privateKey, user.email, bundle.key_id);
  try {
    await assertKeyPair(await unwrapPrivateKey(next.wrapKey, wrapped, user.email, bundle.key_id), publicKey);
  } catch {
    throw new KeysOpenError();
  }
  await apiPost(
    '/api/auth/change-password',
    changePasswordBody(
      credentials.auth,
      next.auth,
      toBase64Url(wrapped),
      bundle.keys_version,
      passwordLength(newPassword) >= ADMIN_MIN_LENGTH
    ),
    'fail.password_change'
  );
}

/** What "Create a new recovery key" holds between the password and the last request: the opened private key, only inside this object. */
export class NewRecoveryKeyFlow {
  private privateKey: CryptoKey | null;
  private auth: string | null;
  private readonly keyId: string;
  private readonly keysVersion: number;
  private readonly address: string;
  private readonly publicKeySpki: string;

  private constructor(address: string, privateKey: CryptoKey, auth: string, bundle: KeyBundle) {
    this.address = address;
    this.privateKey = privateKey;
    this.auth = auth;
    this.keyId = bundle.key_id;
    this.keysVersion = bundle.keys_version;
    this.publicKeySpki = bundle.public_key;
  }

  /** Step 1: the password. A wrong password is found here, locally, before a key is shown. */
  static async start(user: Pick<SessionUser, 'email'>, password: string): Promise<NewRecoveryKeyFlow> {
    const bundle = await myBundle();
    const { credentials, privateKey } = await openWithPassword(user, password, bundle);
    return new NewRecoveryKeyFlow(user.email, privateKey, credentials.auth, bundle);
  }

  /** The last request, after the new key was shown and confirmed. The old recovery key stops working at once. */
  async complete(draft: RecoveryKeyDraft): Promise<void> {
    if (this.privateKey === null || this.auth === null) {
      throw new Error('this flow was discarded');
    }
    const wrapped = await draft.wrap(this.privateKey, this.address, this.keyId);
    await draft.opens(wrapped, this.address, this.keyId, await parsePublicKey(fromBase64Url(this.publicKeySpki)));
    await apiPost(
      '/api/keys/recovery',
      newRecoveryKeyBody(this.auth, wrapped, await draft.proof(), this.keysVersion),
      'fail.recovery_replace'
    );
    this.discard();
  }

  discard(): void {
    this.privateKey = null;
    this.auth = null;
  }
}

/** "I am here now": a code from the authenticator app; the session then carries a second-factor mark for five minutes. */
export const stepUp = (code: string): Promise<unknown> => apiPost('/api/auth/step-up', stepUpBody(code), 'fail.step_up');

/** The three two-factor actions that take the password and one code. `disable` is refused by the server for an admin or when the organisation requires it. */
export async function disableTwoFactor(user: Pick<SessionUser, 'email'>, password: string, code: string): Promise<SessionUser> {
  const { auth } = await deriveCredentials(password, user.email);
  const answer = await apiPost<{ user: SessionUser }>('/api/auth/2fa/disable', twoFactorBody(auth, code), 'fail.two_factor_disable');
  return answer.user;
}

export async function newRecoveryCodes(user: Pick<SessionUser, 'email'>, password: string, code: string): Promise<string[]> {
  const { auth } = await deriveCredentials(password, user.email);
  const answer = await apiPost<{ recovery_codes: string[] }>(
    '/api/auth/2fa/recovery-codes',
    twoFactorBody(auth, code),
    'fail.two_factor_codes'
  );
  return answer.recovery_codes;
}

/** What the server answers when the deletion of locked mail was marked: how many messages, and the date it will carry it out. */
export interface LockedDeleteAnswer {
  key_id: string;
  locked: number;
  delete_requested_at: number | null;
  delete_after: number | null;
}

/**
 * "Delete the locked old mail": the password becomes `auth` here and nothing else of it is sent; an account with two-factor sign-in first shows a
 * fresh code (the server wants that second step for this action). Nothing is deleted at once: the answer carries the date the server will do it,
 * and the person can cancel until then.
 */
export async function requestLockedDelete(
  user: Pick<SessionUser, 'email' | 'totp_enabled'>,
  password: string,
  code: string,
  keyId: string
): Promise<LockedDeleteAnswer> {
  const { auth } = await deriveCredentials(password, user.email);
  if (user.totp_enabled) {
    await stepUp(code);
  }
  return apiPost<LockedDeleteAnswer>('/api/keys/delete-locked', lockedDeleteBody(auth, keyId), 'fail.locked_delete');
}

/** Enrolment from Settings (an account that has none): the credentials the enrolment screen repeats with its two calls, made from the password just typed. */
export async function enrolmentCredentials(
  user: Pick<SessionUser, 'email'>,
  password: string
): Promise<{ email: string; auth: string; wrapKey: CryptoKey; persist: boolean }> {
  const { auth, wrapKey } = await deriveCredentials(password, user.email);
  return { email: user.email.trim().toLowerCase(), auth, wrapKey, persist: true };
}
