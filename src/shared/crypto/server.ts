// SERVER ENTRY of the shared crypto module: what the Worker may import. SEAL-ONLY by construction (CR-1 of crypto-review.md): no HPKE open,
// no private-key import or unwrap, no ECDH with a stored key. The Worker's crypto.subtle surface through this entry is digest, HKDF,
// PBKDF2 (the `auth` verifier), AES-GCM encrypt and ECDH with the ephemeral key inside an HPKE seal. test/crypto/static.test.ts
// checks the import closure of this file; scripts/check-worker-bundle.mjs checks the built Worker bundle.

export { concat, CryptoFormatError, decodeCanonical, equalBytes, fromBase64Url, isUuid, toBase64Url, utf8 } from './bytes';
export type { Bytes } from './bytes';
export * from './constants';
export { sealBlob } from './blob';
export { dataMacs, isCurrent, loadDataKeys, openData, openLegacyVapidKey, sealData } from './data-key';
export type { DataKeys, DataMacPurpose, DataPurpose } from './data-key';
export { hkdf } from './hkdf';
export { keyIdOf, parsePublicKey } from './public-key';
export type { PublicKey } from './public-key';
export {
  blobAad,
  cekAad,
  cekInfo,
  checkPurpose,
  checkRowId,
  newCek,
  packWrappedCek,
  parseWrappedCek,
  sealCek,
  sealField
} from './envelope';
export type { WrappedCek } from './envelope';
export {
  createSecretVerifier,
  createVerifier,
  decodeAuth,
  dummyVerify,
  dummyVerifySecret,
  isAuthValue,
  isUsableIterations,
  verifyAuth,
  verifySecret
} from './verifier';
export type { SecretVerifier, Verifier } from './verifier';
