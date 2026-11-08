import { concat, CryptoFormatError, CryptoOpenError, equalBytes, toBase64Url, utf8 } from './bytes';
import type { Bytes } from './bytes';
import { DATA_KEY_BYTES, DATA_KID_BYTES, FORMAT_VERSION, GCM_TAG_BYTES, IV_BYTES, LABEL } from './constants';
import { hkdf } from './hkdf';

// DATA_KEY (design M2 / RR-5): the Worker secret that protects what the SERVER must be able to read back: pending mail's content keys,
// TOTP secrets, recovery-code HMACs, audit MACs and the VAPID private key. It is NOT the root of any user's mail: that is the user's own
// key pair. Every sealed value is `0x01 || kid(4) || iv(12) || ciphertext || tag`; the kid says which key sealed it, so DATA_KEY_PREVIOUS can
// stay readable during a rotation while everything new is sealed under the current key.

/**
 * The uses of DATA_KEY. Each has its own derived key and its own AAD prefix (the same label, used once, here). The two groups never mix:
 * a purpose that seals (AES-GCM) is not one that signs (HMAC), so a derived key never serves both primitives.
 */
const SEAL_PURPOSE = { pendingCek: LABEL.dataPending, totp: LABEL.dataTotp, vapid: LABEL.dataVapid } as const;
const MAC_PURPOSE = { recoveryCode: LABEL.dataRecoveryCode, audit: LABEL.dataAudit, forgotTicket: LABEL.dataTicket } as const;
export type DataPurpose = keyof typeof SEAL_PURPOSE;
export type DataMacPurpose = keyof typeof MAC_PURPOSE;

interface DataKey {
  raw: Bytes;
  kid: Bytes;
}

export interface DataKeys {
  current: DataKey;
  /** Read-only: opens values sealed before a rotation. Never used to seal. */
  previous: DataKey | undefined;
}

/** Standard base64 of exactly 32 bytes, in its canonical padded spelling (what `openssl rand -base64 32` prints). */
function decodeKey(text: string | undefined): Bytes | undefined {
  const value = text?.trim() ?? '';
  if (!/^[A-Za-z\d+/]{43}=$/.test(value)) {
    return undefined;
  }
  let bytes: Bytes;
  try {
    bytes = Uint8Array.from(atob(value), (char) => char.codePointAt(0) ?? 0);
  } catch {
    return undefined;
  }
  // A placeholder such as all zeros or a repeated byte is not a random key.
  const distinct = new Set(bytes).size;
  return bytes.length === DATA_KEY_BYTES && distinct >= 8 && btoa(String.fromCodePoint(...bytes)) === value ? bytes : undefined;
}

async function toDataKey(raw: Bytes): Promise<DataKey> {
  return { raw, kid: await hkdf(raw, utf8(LABEL.dataKid), DATA_KID_BYTES) };
}

/**
 * The keys of a deployment, or undefined when DATA_KEY is missing or malformed, or equal to one of the `others` (JWT_SECRET, the setup
 * key: one leaked secret must not open the other's data). A malformed DATA_KEY_PREVIOUS counts as missing it: only the current key matters.
 */
export async function loadDataKeys(
  current: string | undefined,
  previous: string | undefined,
  others: readonly (string | undefined)[]
): Promise<DataKeys | undefined> {
  const raw = decodeKey(current);
  if (raw === undefined || others.some((other) => other !== undefined && other.trim() === current?.trim())) {
    return undefined;
  }
  // A previous key that is another secret is not a rotation either: ignored like a malformed one.
  const oldRaw = others.some((other) => other !== undefined && other.trim() === previous?.trim()) ? undefined : decodeKey(previous);
  const keys = { current: await toDataKey(raw), previous: oldRaw === undefined ? undefined : await toDataKey(oldRaw) };
  // The same key twice is a configuration slip, not a rotation.
  return keys.previous !== undefined && equalBytes(keys.previous.kid, keys.current.kid) ? { ...keys, previous: undefined } : keys;
}

const purposeKey = async (key: DataKey, purpose: DataPurpose, usage: 'encrypt' | 'decrypt'): Promise<CryptoKey> =>
  crypto.subtle.importKey('raw', await hkdf(key.raw, utf8(SEAL_PURPOSE[purpose]), DATA_KEY_BYTES), 'AES-GCM', false, [usage]);

const contextAad = (label: string, context: string): Bytes => utf8(`${label}\0${context}`);

/** Seals `plaintext` under the CURRENT key for one purpose; `context` (a row or user id) is authenticated, so a value cannot be moved. */
export async function sealData(keys: DataKeys, purpose: DataPurpose, context: string, plaintext: Bytes): Promise<Bytes> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: contextAad(SEAL_PURPOSE[purpose], context), tagLength: 128 },
      await purposeKey(keys.current, purpose, 'encrypt'),
      plaintext
    )
  );
  return concat(Uint8Array.of(FORMAT_VERSION), keys.current.kid, iv, sealed);
}

/** The key (current or previous) that sealed a value, by its kid. */
function keyFor(keys: DataKeys, blob: Uint8Array): DataKey {
  const kid = blob.subarray(1, 1 + DATA_KID_BYTES);
  const found = [keys.current, keys.previous].find((key) => key !== undefined && equalBytes(key.kid, kid));
  if (found === undefined) {
    throw new CryptoOpenError();
  }
  return found;
}

/** True when a value is sealed under the current key (this version has no pass that re-seals the others: DATA_KEY_PREVIOUS stays needed while they exist). */
export const isCurrent = (keys: DataKeys, blob: Uint8Array): boolean => equalBytes(blob.subarray(1, 1 + DATA_KID_BYTES), keys.current.kid);

/** Opens a value sealed by `sealData`. Any failure (unknown kid, wrong context, damaged) is the same CryptoOpenError. */
export async function openData(keys: DataKeys, purpose: DataPurpose, context: string, blob: Uint8Array): Promise<Bytes> {
  if (blob.length < 1 + DATA_KID_BYTES + IV_BYTES + GCM_TAG_BYTES || blob[0] !== FORMAT_VERSION) {
    throw new CryptoFormatError('Unknown or damaged sealed value');
  }
  const key = keyFor(keys, blob);
  const iv = blob.slice(1 + DATA_KID_BYTES, 1 + DATA_KID_BYTES + IV_BYTES);
  try {
    return new Uint8Array(
      await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv, additionalData: contextAad(SEAL_PURPOSE[purpose], context), tagLength: 128 },
        await purposeKey(key, purpose, 'decrypt'),
        blob.slice(1 + DATA_KID_BYTES + IV_BYTES)
      )
    );
  } catch {
    throw new CryptoOpenError();
  }
}

/**
 * HMAC-SHA256 of `message` for one purpose under the current key, as base64url (what is stored), plus the same under the previous key
 * (what a lookup must also try during a rotation). The message always starts with the purpose label, so two uses never share a MAC.
 */
export async function dataMacs(keys: DataKeys, purpose: DataMacPurpose, message: string): Promise<{ current: string; all: string[] }> {
  const compute = async (key: DataKey): Promise<string> => {
    const mac = await crypto.subtle.importKey(
      'raw',
      await hkdf(key.raw, utf8(MAC_PURPOSE[purpose]), DATA_KEY_BYTES),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    return toBase64Url(new Uint8Array(await crypto.subtle.sign('HMAC', mac, contextAad(MAC_PURPOSE[purpose], message))));
  };
  const current = await compute(keys.current);
  return { current, all: keys.previous === undefined ? [current] : [current, await compute(keys.previous)] };
}

/**
 * Reads the Web Push private key as the single-user version sealed it, for an install that is being upgraded (nothing writes this format any more;
 * the caller seals the key again under DATA_KEY at once, so this runs whenever the stored value is in the old format, which after the first push
 * following the upgrade is never). That version used AES-GCM under HKDF-SHA-256(JWT_SECRET, salt `edging-mail`, info `vapid private key v1`) with a
 * 12-byte IV in front and the public key as associated data. undefined when it does not open: an empty or another secret, another public key, a value
 * of the current format, or damage. The one server decrypt that is not under DATA_KEY, which is why it lives here with the others.
 *
 * REMOVE THIS FUNCTION (and `unsealLegacy` in worker/push.ts, its tests, and the "Upgrading from the single-user version" paragraphs of
 * docs/configuration.md and docs/deployment.md) in the first release after the upgrade window: once every install has pushed once since the upgrade,
 * nothing reads the old format and `JWT_SECRET` plays no part in the push key.
 */
export async function openLegacyVapidKey(jwtSecret: string, publicKey: string, sealed: Bytes): Promise<Bytes | undefined> {
  // A blob sealed under an empty secret would open, so the primitive refuses the empty secret itself.
  if (jwtSecret === '') {
    return undefined;
  }
  try {
    const raw = await hkdf(utf8(jwtSecret), utf8('vapid private key v1'), 32, utf8('edging-mail'));
    const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['decrypt']);
    return new Uint8Array(
      await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: sealed.slice(0, IV_BYTES), additionalData: utf8(publicKey) },
        key,
        sealed.slice(IV_BYTES)
      )
    );
  } catch {
    return undefined;
  }
}
