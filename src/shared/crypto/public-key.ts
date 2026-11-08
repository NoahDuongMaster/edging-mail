import { CryptoFormatError, toBase64Url, equalBytes } from './bytes';
import type { Bytes } from './bytes';
import { KEY_ID_BYTES, P256_SPKI_BYTES } from './constants';

declare const minted: unique symbol;

/** Only `parsePublicKey` (and so `generateUserKeyPair`) makes one: the key id always belongs to the key. */
export interface PublicKey {
  readonly [minted]: true;
  /** The SubjectPublicKeyInfo as stored (`users.public_key`). */
  spki: Bytes;
  /** Usable as an HPKE recipient. */
  key: CryptoKey;
  /** First 16 bytes of SHA-256(SPKI): raw in blob headers... */
  keyIdRaw: Bytes;
  /** ...and as base64url text in columns, AAD and `info`. The reader checks header == column. */
  keyId: string;
}

const P256 = { name: 'ECDH', namedCurve: 'P-256' } as const;

export const keyIdOf = async (spki: Bytes): Promise<{ keyIdRaw: Bytes; keyId: string }> => {
  const keyIdRaw = new Uint8Array(await crypto.subtle.digest('SHA-256', spki)).slice(0, KEY_ID_BYTES);
  return { keyIdRaw, keyId: toBase64Url(keyIdRaw) };
};

/**
 * A P-256 public key from its stored SPKI, checked strictly: exactly 91 bytes, a point on the curve, and the canonical DER encoding of
 * that point (importing and re-exporting must give the same bytes), so one key has one `key_id`.
 */
export async function parsePublicKey(spki: Bytes): Promise<PublicKey> {
  if (spki.length !== P256_SPKI_BYTES) {
    throw new CryptoFormatError('Not a P-256 public key');
  }
  let key: CryptoKey;
  try {
    key = await crypto.subtle.importKey('spki', spki, P256, true, []);
  } catch {
    throw new CryptoFormatError('Not a P-256 public key');
  }
  if (!equalBytes(new Uint8Array(await crypto.subtle.exportKey('spki', key)), spki)) {
    throw new CryptoFormatError('Not a canonical P-256 public key');
  }
  return { spki, key, ...(await keyIdOf(spki)) } as PublicKey;
}
