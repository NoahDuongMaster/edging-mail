import {
  assertKeyPair,
  decodeRecoveryKey,
  deriveCredentials,
  deriveRecoveryAuth,
  fromBase64Url,
  parsePublicKey,
  recoveryWrapKey,
  toBase64Url,
  unwrapPrivateKey,
  wrapPrivateKey
} from '../../../shared/crypto/client';
import type { PublicKey } from '../../../shared/crypto/client';
import { apiPost } from '../api';
import { KeysOpenError } from './errors';
import { forgotCompleteBody, forgotVerifyBody } from './requests';
import type { SecondFactor } from './requests';
import type { RecoveryKeyDraft } from './recoveryDraft';

// "Forgot password" (crypto-design.md 15.3), the browser's half. Step 1 proves the recovery key to the server (`recovery_auth`, never the key) and
// gets a ticket plus the recovery-wrapped private key; the browser opens it with the recovery key (an extractable copy that lives only in this
// object), then step 3 re-wraps it under the NEW password and a NEW recovery key. Nothing changes on the server until the new recovery key has
// been shown and confirmed and the last request is made: an abandoned flow changes nothing.

interface VerifyAnswer {
  ticket: string;
  public_key: string;
  key_id: string;
  keys_version: number;
  wrapped_private_key_recovery: string;
  min_password_length: number;
}

/** Digits (six, spaces allowed) are the authenticator code; anything else typed is read as one single-use recovery code; empty is no code. */
export function parseFactorInput(text: string): SecondFactor | null {
  const trimmed = text.trim();
  if (trimmed === '') {
    return null;
  }
  const digits = trimmed.replaceAll(/\s/g, '');
  return /^\d{6}$/.test(digits) ? { code: digits } : { recovery_code: trimmed };
}

export class ForgotFlow {
  /** 16 for an admin, 12 otherwise: the server knows the role, the browser enforces the length. */
  readonly minPasswordLength: number;
  private privateKey: CryptoKey | null;
  private ticket: string | null;
  private readonly keyId: string;
  private readonly email: string;
  private readonly publicKey: PublicKey;

  private constructor(email: string, answer: VerifyAnswer, privateKey: CryptoKey, publicKey: PublicKey) {
    this.email = email;
    this.minPasswordLength = answer.min_password_length;
    this.privateKey = privateKey;
    this.ticket = answer.ticket;
    this.keyId = answer.key_id;
    this.publicKey = publicKey;
  }

  /**
   * Step 1. The typed recovery key is checked in the browser first (length, alphabet, check characters: a typo never reaches the server, and the
   * error says which kind it is), then proven; the answer is opened with the same key. Throws RecoveryKeyError, ApiError or KeysOpenError.
   */
  static async verify(email: string, recoveryKeyText: string, factorText: string): Promise<ForgotFlow> {
    const address = email.trim().toLowerCase();
    const recoveryKey = await decodeRecoveryKey(recoveryKeyText);
    try {
      const { text: proof } = await deriveRecoveryAuth(recoveryKey);
      const answer = await apiPost<VerifyAnswer>(
        '/api/auth/forgot/verify',
        forgotVerifyBody(address, proof, parseFactorInput(factorText)),
        'fail.forgot_verify'
      );
      try {
        const publicKey = await parsePublicKey(fromBase64Url(answer.public_key));
        const privateKey = await unwrapPrivateKey(
          await recoveryWrapKey(recoveryKey),
          fromBase64Url(answer.wrapped_private_key_recovery),
          address,
          answer.key_id,
          true
        );
        await assertKeyPair(privateKey, publicKey);
        return new ForgotFlow(address, answer, privateKey, publicKey);
      } catch {
        throw new KeysOpenError();
      }
    } finally {
      recoveryKey.fill(0);
    }
  }

  /**
   * Step 3, after the new recovery key was shown and confirmed: wraps the private key under the new password and under the new recovery key,
   * re-opens both wraps (a request the browser could not open later is never sent), and sends the one request that changes everything.
   */
  async complete(newPassword: string, draft: RecoveryKeyDraft): Promise<void> {
    if (this.privateKey === null || this.ticket === null) {
      throw new Error('this recovery was discarded');
    }
    const next = await deriveCredentials(newPassword, this.email);
    const wrappedPw = await wrapPrivateKey(next.wrapKey, this.privateKey, this.email, this.keyId);
    const wrappedRecovery = await draft.wrap(this.privateKey, this.email, this.keyId);
    try {
      await assertKeyPair(await unwrapPrivateKey(next.wrapKey, wrappedPw, this.email, this.keyId), this.publicKey);
      await draft.opens(wrappedRecovery, this.email, this.keyId, this.publicKey);
    } catch {
      throw new KeysOpenError();
    }
    await apiPost(
      '/api/auth/forgot/complete',
      forgotCompleteBody(this.ticket, next.auth, toBase64Url(wrappedPw), wrappedRecovery, await draft.proof()),
      'fail.forgot_complete'
    );
    this.discard();
  }

  discard(): void {
    this.privateKey = null;
    this.ticket = null;
  }
}
