import { CryptoFormatError, toBase64Url, utf8 } from './bytes';
import type { Bytes } from './bytes';
import { AUTH_BYTES, LABEL, PASSWORD_MAX_CODE_POINTS, PASSWORD_MIN_CODE_POINTS, PBKDF2_CLIENT_ITERATIONS } from './constants';
import { hkdf } from './hkdf';

// Password -> keys (crypto-design.md section 3). Browser entry only: the server never sees a password.

/**
 * The primary address as the KDF sees it: trimmed, lower-cased, printable ASCII, one `@`. An alias is not a login identifier, and an
 * address with other characters is refused BEFORE the KDF, so two spellings can never derive two different keys for one account.
 */
export function canonicalAddress(input: string): string {
  // ASCII is tested BEFORE lower-casing: toLowerCase folds a few non-ASCII letters (the Kelvin sign U+212A) into ASCII ones.
  const trimmed = input.trim();
  const address = trimmed.toLowerCase();
  if (!/^[\u0021-\u007E]+$/.test(trimmed) || address.split('@').length !== 2 || address.startsWith('@') || address.endsWith('@')) {
    throw new CryptoFormatError('Not a primary address');
  }
  return address;
}

/** NFKC, then UTF-8: the same password typed on any keyboard or platform gives the same bytes. */
export const normalizePassword = (password: string): string => password.normalize('NFKC');

/** The length rule, counted in Unicode code points after NFKC. The server cannot check it; this is the only place that does. */
export function isAcceptablePassword(password: string): boolean {
  let length = 0;
  // Iterating a string yields one entry per code point
  for (const codePoint of normalizePassword(password)) {
    length += codePoint.length > 0 ? 1 : 0;
  }
  return length >= PASSWORD_MIN_CODE_POINTS && length <= PASSWORD_MAX_CODE_POINTS;
}

/** salt = SHA-256(kdfSalt label || 0x00 || primary address): public and deterministic, so no round trip is needed before sign-in. */
export const kdfSalt = async (address: string): Promise<Bytes> =>
  new Uint8Array(await crypto.subtle.digest('SHA-256', utf8(`${LABEL.kdfSalt}\0${canonicalAddress(address)}`)));

export interface KeyMaterial {
  salt: Bytes;
  /** The PBKDF2 output. Never sent, never stored. */
  mk: Bytes;
  /** The credential sent to the server. */
  auth: Bytes;
  /** The key that wraps the private key. Never sent. */
  wk: Bytes;
}

/** The whole chain as raw bytes: for the known-answer tests only (it is not exported by the client entry, so no screen can hold `mk`). */
export async function deriveKeyMaterial(password: string, address: string): Promise<KeyMaterial> {
  const salt = await kdfSalt(address);
  const secret = await crypto.subtle.importKey('raw', utf8(normalizePassword(password)), 'PBKDF2', false, ['deriveBits']);
  const mk = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PBKDF2_CLIENT_ITERATIONS }, secret, 256)
  );
  return { salt, mk, auth: await hkdf(mk, utf8(LABEL.auth), AUTH_BYTES), wk: await hkdf(mk, utf8(LABEL.wrap), 32) };
}

/** What a sign-in needs: `auth` (base64url, for the request) and the non-extractable key that wraps and unwraps the private key. */
export async function deriveCredentials(password: string, address: string): Promise<{ auth: string; wrapKey: CryptoKey }> {
  const { mk, auth, wk } = await deriveKeyMaterial(password, address);
  const wrapKey = await crypto.subtle.importKey('raw', wk, 'AES-GCM', false, ['wrapKey', 'unwrapKey']);
  const text = toBase64Url(auth);
  // Best effort (the runtime may have copied them): nothing but the non-extractable key and the credential stays reachable.
  mk.fill(0);
  auth.fill(0);
  wk.fill(0);
  return { auth: text, wrapKey };
}
