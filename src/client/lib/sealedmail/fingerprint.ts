// What two people compare to be sure a key is the one they think it is (S3): SHA-256 of the public key as stored (SPKI), the first 120 bits
// as six groups of five decimal digits ("04821 77310 ..."). Groups of digits are easy to read aloud on a phone call.
import type { Bytes } from '../../../shared/crypto/client';

const GROUPS = 6;
const GROUP_BITS = 20;

/** The six groups of a SHA-256 digest: bits 20n to 20n+19, each read as a number, mod 100000, zero padded to five digits. */
export function fingerprintGroups(digest: Uint8Array): string[] {
  if (digest.length < (GROUPS * GROUP_BITS) / 8) {
    throw new RangeError('a fingerprint needs at least 15 bytes');
  }
  return Array.from({ length: GROUPS }, (_, index) => {
    const bit = index * GROUP_BITS;
    const byte = bit >> 3;
    // Three bytes hold 20 bits starting at bit 0 or bit 4 of the first one (20n mod 8 is 0 or 4).
    const window = (digest[byte] << 16) | (digest[byte + 1] << 8) | digest[byte + 2];
    const value = (window >> (24 - (bit & 7) - GROUP_BITS)) & 0xf_ff_ff;
    return String(value % 100_000).padStart(5, '0');
  });
}

/** `fingerprintGroups` of SHA-256(spki), joined with single spaces. Deterministic: the same key always gives the same text. */
export async function fingerprintOf(spki: Bytes): Promise<string> {
  return fingerprintGroups(new Uint8Array(await crypto.subtle.digest('SHA-256', spki))).join(' ');
}
