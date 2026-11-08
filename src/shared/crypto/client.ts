// BROWSER ENTRY of the shared crypto module: everything the server entry has, plus the parts that need a secret key: the password KDF,
// the private-key wraps, the recovery-key codec, and the OPEN side of the message envelope (AES-GCM decrypt, HPKE open).
// The Worker must never import this file (see server.ts).

export * from './server';
export { assertKeyPair, openBlob, openField, unwrapCek } from './open';
// deriveKeyMaterial (mk and wk as plain bytes) is deliberately NOT exported here: only the known-answer tests import it from ./kdf.
export { canonicalAddress, deriveCredentials, isAcceptablePassword, kdfSalt, normalizePassword } from './kdf';
export {
  createKeySet,
  generateRecoveryKey,
  generateUserKeyPair,
  privateKeyAad,
  recoveryWrapKey,
  unwrapPrivateKey,
  wrapPrivateKey
} from './keys';
export type { KeySet } from './keys';
export {
  confirmationMatches,
  decodeRecoveryKey,
  deriveRecoveryAuth,
  drawConfirmationGroups,
  encodeRecoveryKey,
  normalizeRecoveryText,
  RecoveryKeyError
} from './recovery-key';
export type { RecoveryKeyProblem } from './recovery-key';
export { CryptoOpenError } from './bytes';
