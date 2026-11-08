import { concat, CryptoFormatError } from './bytes';
import type { Bytes } from './bytes';
import { FORMAT_VERSION, IV_BYTES } from './constants';

// Sealing side of the AES-GCM blob format: 0x01 || iv(12) || ciphertext || tag(16), 96-bit random IV, 128-bit tag. The key is always a
// fresh or purpose-derived one, so a random IV never repeats under a key in practice. Opening is in open.ts (browser entry only).

/** Encrypts `plaintext` under `key`, bound to `aad` (the purpose and the row the blob belongs to). */
export async function sealBlob(key: CryptoKey, aad: Bytes, plaintext: Bytes): Promise<Bytes> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad, tagLength: 128 }, key, plaintext));
  return concat(Uint8Array.of(FORMAT_VERSION), iv, sealed);
}

/** The pieces of a blob, or a CryptoFormatError for a wrong version byte or a blob too short to hold an IV and a tag. */
export function splitBlob(blob: Uint8Array, minimum: number): { iv: Bytes; sealed: Bytes } {
  if (blob.length < minimum || blob[0] !== FORMAT_VERSION) {
    throw new CryptoFormatError('Unknown or damaged blob format');
  }
  return { iv: blob.slice(1, 1 + IV_BYTES), sealed: blob.slice(1 + IV_BYTES) };
}
