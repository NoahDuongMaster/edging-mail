import type { Bytes } from './bytes';

/**
 * HKDF-SHA256 (RFC 5869) with an empty salt, as the design specifies everywhere. `info` is the domain-separation text, already encoded. `salt` exists
 * for one reader only: the Web Push key of the single-user version was derived with a salt (`openLegacyVapidKey`); nothing new uses it.
 */
export async function hkdf(ikm: Bytes, info: Bytes, length: number, salt: Bytes = new Uint8Array(0)): Promise<Bytes> {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8));
}
