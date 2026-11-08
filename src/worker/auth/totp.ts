import { equalBytes, utf8 } from '../../shared/crypto/server';
import type { Bytes } from '../../shared/crypto/server';

// TOTP (RFC 6238 over HOTP, RFC 4226): HMAC-SHA1, 6 digits, 30 second steps, a 160-bit secret, accepting the step before and after the
// current one for clock drift. SHA-1 is what every authenticator app supports; HMAC-SHA1 is not affected by the collision attacks on SHA-1.

const STEP_SECONDS = 30;
const DIGITS = 6;
const SECRET_BYTES = 20;
const WINDOW_STEPS = 1;
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export const newTotpSecret = (): Bytes => crypto.getRandomValues(new Uint8Array(SECRET_BYTES));

/** RFC 4648 base32, no padding: what an authenticator app takes as the manual key. */
export function base32(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  return bits > 0 ? out + BASE32[(value << (5 - bits)) & 31] : out;
}

/** The `otpauth://` link a QR code carries. The label is the account address, the issuer the app name. */
export function otpauthUri(address: string, secret: Uint8Array, issuer: string): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(address)}`;
  return `otpauth://totp/${label}?secret=${base32(secret)}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SECONDS}`;
}

/** The six-digit code of one time step (RFC 4226 HOTP with the step as the counter). */
export async function hotp(secret: Bytes, counter: number): Promise<string> {
  const key = await crypto.subtle.importKey('raw', secret, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const message = new Uint8Array(8);
  new DataView(message.buffer).setBigUint64(0, BigInt(counter));
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, message));
  const offset = (mac.at(-1) ?? 0) & 15;
  const binary =
    (((mac[offset] ?? 0) & 0x7f) << 24) | ((mac[offset + 1] ?? 0) << 16) | ((mac[offset + 2] ?? 0) << 8) | (mac[offset + 3] ?? 0);
  return String(binary % 10 ** DIGITS).padStart(DIGITS, '0');
}

export const stepOf = (nowMs: number): number => Math.floor(nowMs / 1000 / STEP_SECONDS);

/**
 * The step a six-digit code belongs to (the current one or a neighbour), or null. Every candidate is computed and compared in constant time
 * whether or not an earlier one matched, so the time taken does not say which step (or whether any) was right. The caller then accepts only
 * a step later than the last accepted one, so a code works once.
 */
export async function matchingStep(secret: Bytes, code: string, nowMs: number): Promise<number | null> {
  const typed = utf8(code.replaceAll(/\s/g, ''));
  const now = stepOf(nowMs);
  let found: number | null = null;
  for (let offset = -WINDOW_STEPS; offset <= WINDOW_STEPS; offset += 1) {
    const expected = utf8(await hotp(secret, now + offset));
    if (equalBytes(typed, expected)) {
      found = now + offset;
    }
  }
  return found;
}

const RECOVERY_CODES = 10;
const RECOVERY_SYMBOLS = 12;

/** One recovery code: 60 random bits as 12 base32 symbols, shown as XXXX-XXXX-XXXX. */
function newRecoveryCode(): string {
  const random = crypto.getRandomValues(new Uint8Array(8));
  let bits = 0n;
  for (const byte of random) {
    bits = (bits << 8n) | BigInt(byte);
  }
  const symbols = Array.from({ length: RECOVERY_SYMBOLS }, (_, index) => BASE32[Number((bits >> BigInt(5 * index)) & 31n)]).join('');
  return `${symbols.slice(0, 4)}-${symbols.slice(4, 8)}-${symbols.slice(8)}`;
}

export const newRecoveryCodes = (): string[] => Array.from({ length: RECOVERY_CODES }, newRecoveryCode);

/** The canonical spelling of what a person typed: upper case, spaces and hyphens ignored. null when it cannot be a recovery code. */
export function normaliseRecoveryCode(input: string): string | null {
  const code = input.toUpperCase().replaceAll(/[\s-]/g, '');
  return code.length === RECOVERY_SYMBOLS && /^[A-Z2-7]+$/.test(code) ? code : null;
}
