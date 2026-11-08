import { CryptoFormatError, CryptoOpenError, RecoveryKeyError } from '../../../shared/crypto/client';
import { ApiError, UnauthorizedError } from '../api';
import { tr } from '../i18n';

/** The keys the server holds for a person did not open with the password the server accepted: damaged, or not this person's. */
export class KeysOpenError extends Error {
  constructor() {
    // A message for the developer: the screen says it in the catalogue's words.
    super('the stored keys did not open');
    this.name = 'KeysOpenError';
  }
}

/** The reason text of a recovery key that is not valid, before any request or key derivation (crypto-design.md 15.2: length, alphabet, pad, checksum). */
export function recoveryKeyProblemText(error: RecoveryKeyError): string {
  switch (error.reason) {
    case 'checksum': {
      return tr('recovery.problem_checksum');
    }
    case 'length': {
      return tr('recovery.problem_length');
    }
    case 'alphabet':
    case 'pad': {
      return tr('recovery.problem_characters');
    }
  }
}

/** What to tell the person when a sign-in, key or password step failed, in the UI language. Never a technical message. */
export function credentialErrorText(error: unknown): string {
  if (error instanceof RecoveryKeyError) {
    return recoveryKeyProblemText(error);
  }
  if (error instanceof ApiError || error instanceof UnauthorizedError) {
    return error.message;
  }
  if (error instanceof TypeError) {
    return tr('err.network');
  }
  if (error instanceof KeysOpenError || error instanceof CryptoOpenError) {
    return tr('keys.open_failed');
  }
  if (error instanceof CryptoFormatError) {
    return tr('auth.address_invalid');
  }
  return tr('common.something_wrong');
}

/** Seconds a 429 asks the person to wait, when the error is one. */
export const retryAfterOf = (error: unknown): number | null =>
  error instanceof ApiError && error.retryAfter !== undefined ? error.retryAfter : null;
