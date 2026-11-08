// Every constant of the encryption design in ONE place (crypto-design.md sections 2-5 and 13.2): label strings, version bytes, sizes and
// iteration counts. Each label is used by exactly one function elsewhere in this folder and appears nowhere else as a string literal
// (test/crypto/static.test.ts enforces both), so a typo cannot silently create a second, incompatible domain separation.

/** Domain-separation labels: HKDF `info`, AAD prefixes and salts. They are protocol constants, never configuration. */
export const LABEL = {
  /** salt = SHA-256(kdfSalt || 0x00 || primary address) */
  kdfSalt: 'edging-mail/v1/kdf-salt',
  /** auth = HKDF(mk, auth): the credential sent to the server */
  auth: 'edging-mail/v1/auth',
  /** wk = HKDF(mk, wrap): never leaves the browser */
  wrap: 'edging-mail/v1/wrap',
  /** AAD of a wrapped private key: privateKeyAad || 0x00 || address || 0x00 || key_id */
  privateKeyAad: 'edging-mail/v1/privkey',
  /** rwk = HKDF(recovery key, recoveryWrap) */
  recoveryWrap: 'edging-mail/v1/recovery-wrap',
  /** rauth = HKDF(recovery key, recoveryAuth): the forgot-password proof of possession, independent of rwk */
  recoveryAuth: 'edging-mail/v1/recovery-auth',
  /** check2 = first 10 bits of SHA-256(rkCheck || 0x00 || recovery key), the two check symbols of its text form */
  rkCheck: 'edging-mail/v1/rk-check',
  /** AAD of a content blob: blobAad || 0x00 || purpose || 0x00 || row_id */
  blobAad: 'edging-mail/v1/blob',
  /** content key = HKDF(CEK, blobKey || purpose) */
  blobKey: 'edging-mail/v1/key/',
  /** HPKE `info` of a content-key wrap */
  hpkeCek: 'edging-mail/v1/cek',
  /** kid of a DATA_KEY = first bytes of HKDF(DATA_KEY, dataKid): never a plain hash of the key */
  dataKid: 'edging-mail/v1/data/kid',
  /** DATA_KEY purposes: the HKDF `info` of the key AND the prefix of the AAD, so no two uses share a key or a context */
  dataPending: 'edging-mail/v1/data/pending-cek',
  dataTotp: 'edging-mail/v1/data/totp',
  dataVapid: 'edging-mail/v1/data/vapid',
  dataRecoveryCode: 'edging-mail/v1/data/recovery-code',
  dataAudit: 'edging-mail/v1/data/audit',
  dataTicket: 'edging-mail/v1/data/forgot-ticket',
  /** HKDF keys that sign tokens from JWT_SECRET (distinct, so a session cookie is never a valid 2FA challenge) */
  tokenSession: 'edging-mail/v1/token/session',
  tokenChallenge: 'edging-mail/v1/token/2fa-challenge'
} as const;

/** DATA_KEY: base64 of exactly 32 random bytes (`openssl rand -base64 32`). */
export const DATA_KEY_BYTES = 32;
export const DATA_KID_BYTES = 4;

/** First byte of every AES-GCM blob and of every wrapped CEK. Any other value is a hard failure, never "try anyway". */
export const FORMAT_VERSION = 1;
/** Second byte of a wrapped CEK: DHKEM(P-256, HKDF-SHA256) / HKDF-SHA256 / AES-256-GCM, HPKE base mode. */
export const HPKE_SUITE_BASE = 1;

export const IV_BYTES = 12;
export const GCM_TAG_BYTES = 16;
export const CEK_BYTES = 32;
export const KEY_ID_BYTES = 16;
/** An uncompressed P-256 point (0x04 || X || Y): the HPKE `enc` and the raw public key. */
export const P256_POINT_BYTES = 65;
/** DER SubjectPublicKeyInfo of a P-256 key. */
export const P256_SPKI_BYTES = 91;
/** 0x01 || suite || key_id || enc || (CEK + tag). */
export const WRAPPED_CEK_BYTES = 2 + KEY_ID_BYTES + P256_POINT_BYTES + CEK_BYTES + GCM_TAG_BYTES;
export const RECOVERY_KEY_BYTES = 32;

/** `auth` on the wire: 32 raw bytes as unpadded base64url. */
export const AUTH_BYTES = 32;
/** The browser-side key derivation `auth` comes from. The login request states it and unknown values are refused. */
export const KDF_VERSION = 1;
/** Browser: PBKDF2-HMAC-SHA256 over the password (the threat-model number against a stolen wrapped key). */
export const PBKDF2_CLIENT_ITERATIONS = 600_000;
/**
 * Server verifier of `auth`: 100,000 is the highest PBKDF2 count Cloudflare's production Workers runtime accepts (above it deriveBits
 * throws NotSupportedError; the local workerd does not enforce it, so a test pins this constant). The count is stored per user row.
 */
export const PBKDF2_VERIFIER_ITERATIONS = 100_000;
export const VERIFIER_SALT_BYTES = 16;
export const VERIFIER_BYTES = 32;

/** The password rule, counted in Unicode code points after NFKC. Enforced by the client: the server never sees the password. */
export const PASSWORD_MIN_CODE_POINTS = 12;
export const PASSWORD_MAX_CODE_POINTS = 256;
