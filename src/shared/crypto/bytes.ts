// Byte helpers shared by the Worker and the browser. Nothing here is secret-dependent except equalBytes, which is constant-time.

export type Bytes = Uint8Array<ArrayBuffer>;

/** A blob, key, id or encoding that is not what the format allows. Messages are fixed text: they never quote what was parsed. */
export class CryptoFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CryptoFormatError';
  }
}

/** Authenticated decryption failed: wrong key, wrong context (AAD) or altered data. Deliberately says nothing more. */
export class CryptoOpenError extends Error {
  constructor() {
    super('Could not open the encrypted data');
    this.name = 'CryptoOpenError';
  }
}

const encoder = new TextEncoder();

export const utf8 = (text: string): Bytes => encoder.encode(text);

export function concat(...parts: readonly Uint8Array[]): Bytes {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** Unpadded base64url. */
export function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  // In slices: spreading a large array into one call overflows the stack.
  for (let start = 0; start < bytes.length; start += 0x80_00) {
    binary += String.fromCodePoint(...bytes.subarray(start, start + 0x80_00));
  }
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

/** Lenient decoder (throws on characters outside the alphabet). Use `decodeCanonical` for anything a client sends. */
export const fromBase64Url = (value: string): Bytes =>
  Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), (char) => char.codePointAt(0) ?? 0);

/**
 * Strict base64url: the exact canonical spelling of its bytes (alphabet, no padding, unused trailing bits zero), optionally of an exact
 * length. null for anything else, so one value has one encoding and a comparison of the text is a comparison of the bytes.
 */
export function decodeCanonical(value: unknown, byteLength?: number): Bytes | null {
  if (typeof value !== 'string' || !/^[\w-]*$/.test(value)) {
    return null;
  }
  let bytes: Bytes;
  try {
    bytes = fromBase64Url(value);
  } catch {
    return null;
  }
  if (byteLength !== undefined && bytes.length !== byteLength) {
    return null;
  }
  return toBase64Url(bytes) === value ? bytes : null;
}

/** Compares every byte whatever the first difference is. */
export function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  let difference = a.length ^ b.length;
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    difference |= (a[index] ?? 0) ^ (b[index] ?? 0);
  }
  return difference === 0;
}

/** Lower-case canonical UUID: what row ids and user ids are. */
export const isUuid = (value: unknown): value is string =>
  typeof value === 'string' && /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/.test(value);
