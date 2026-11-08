import {
  CryptoFormatError,
  decodeCanonical,
  FORMAT_VERSION,
  GCM_TAG_BYTES,
  IV_BYTES,
  parseWrappedCek,
  toBase64Url
} from '../../shared/crypto/server';

// Shape checks for what a browser sends as ciphertext: the server cannot read it, so it only makes sure it is what the format allows
// (canonical encoding, version byte, a size that fits an IV and a tag, at most `maxBytes`) and that the wrapped key names the key it
// should. The size cap is on the decoded bytes.

/** A content blob (`0x01 || iv || ciphertext || tag`) as the canonical base64url text it arrived as, or null. */
export function parseContentBlob(value: unknown, maxBytes: number): string | null {
  const bytes = decodeCanonical(value);
  return typeof value === 'string' &&
    bytes !== null &&
    bytes[0] === FORMAT_VERSION &&
    bytes.length >= 1 + IV_BYTES + GCM_TAG_BYTES &&
    bytes.length <= maxBytes
    ? value
    : null;
}

/** A wrapped content key whose header names `keyId` (the user's current key); null for anything else. */
export function parseWrappedCekFor(value: unknown, keyId: string | null): string | null {
  const bytes = decodeCanonical(value);
  if (typeof value !== 'string' || bytes === null || keyId === null) {
    return null;
  }
  try {
    return toBase64Url(parseWrappedCek(bytes).keyIdRaw) === keyId ? value : null;
  } catch (error) {
    if (error instanceof CryptoFormatError) {
      return null;
    }
    throw error;
  }
}
