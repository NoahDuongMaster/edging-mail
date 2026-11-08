import { concat, CryptoFormatError, toBase64Url, utf8 } from './bytes';
import type { Bytes } from './bytes';
import { AUTH_BYTES, LABEL, RECOVERY_KEY_BYTES } from './constants';
import { hkdf } from './hkdf';

// The recovery key as text (crypto-design.md 15.2, crypto-review.md 11.1): the 256-bit key + 4 zero pad bits = 52 Crockford base32 symbols,
// then 2 check symbols = 54 symbols, shown as 9 groups of 6. The checksum is a typo detector, not a security control. Browser entry only.

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const KEY_SYMBOLS = 52;
const TEXT_SYMBOLS = 54;
const GROUP_SIZE = 6;
const GROUPS = TEXT_SYMBOLS / GROUP_SIZE;
const PAD_BITS = 4n;

export type RecoveryKeyProblem = 'length' | 'alphabet' | 'pad' | 'checksum';

/** What is wrong with typed text (the UI may say which; it never says anything about the server's opinion of a key). */
export class RecoveryKeyError extends CryptoFormatError {
  readonly reason: RecoveryKeyProblem;

  constructor(reason: RecoveryKeyProblem) {
    super(`The recovery key text is not valid (${reason})`);
    this.reason = reason;
  }
}

/** check2: the first 10 bits of SHA-256(rkCheck label || 0x00 || key) as two 5-bit symbols, high symbol first. */
async function checkSymbols(recoveryKey: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', concat(utf8(LABEL.rkCheck), Uint8Array.of(0), recoveryKey)));
  const bits = (digest[0] << 2) | (digest[1] >> 6);
  return `${ALPHABET[bits >> 5]}${ALPHABET[bits & 31]}`;
}

/** The text a person writes down: 9 groups of 6 separated by hyphens. */
export async function encodeRecoveryKey(recoveryKey: Uint8Array): Promise<string> {
  if (recoveryKey.length !== RECOVERY_KEY_BYTES) {
    throw new CryptoFormatError('A recovery key is 32 bytes');
  }
  let bits = 0n;
  for (const byte of recoveryKey) {
    bits = (bits << 8n) | BigInt(byte);
  }
  bits <<= PAD_BITS;
  const symbols = Array.from(
    { length: KEY_SYMBOLS },
    (_, index) => ALPHABET[Number((bits >> BigInt(5 * (KEY_SYMBOLS - 1 - index))) & 31n)]
  );
  return `${symbols.join('')}${await checkSymbols(recoveryKey)}`.match(/.{6}/g)?.join('-') ?? '';
}

/**
 * The text as the decoder reads it: NFKC first (full-width letters and the ideographic space typed with a CJK input method), spaces and
 * hyphens removed, upper case, and the look-alikes I and L read as 1, O as 0 (Crockford).
 */
export const normalizeRecoveryText = (text: string): string =>
  text.normalize('NFKC').replaceAll(/[\s-]/g, '').toUpperCase().replaceAll(/[IL]/g, '1').replaceAll('O', '0');

/**
 * Reads what a person typed or pasted. Checked in this order, all before any key derivation or request: length (54), alphabet, the 4 pad
 * bits (zero, even when the checksum would pass), checksum. A typo is refused here; it never decodes to a different key.
 */
export async function decodeRecoveryKey(text: string): Promise<Bytes> {
  const folded = normalizeRecoveryText(text);
  if (folded.length !== TEXT_SYMBOLS) {
    throw new RecoveryKeyError('length');
  }
  const values = Array.from(folded, (symbol) => ALPHABET.indexOf(symbol));
  if (values.includes(-1)) {
    throw new RecoveryKeyError('alphabet');
  }
  let bits = 0n;
  for (const value of values.slice(0, KEY_SYMBOLS)) {
    bits = (bits << 5n) | BigInt(value);
  }
  if ((bits & ((1n << PAD_BITS) - 1n)) !== 0n) {
    throw new RecoveryKeyError('pad');
  }
  bits >>= PAD_BITS;
  const key = Uint8Array.from({ length: RECOVERY_KEY_BYTES }, (_, index) =>
    Number((bits >> BigInt(8 * (RECOVERY_KEY_BYTES - 1 - index))) & 255n)
  );
  if (folded.slice(KEY_SYMBOLS) !== (await checkSymbols(key))) {
    throw new RecoveryKeyError('checksum');
  }
  return key;
}

/** `rauth`: the proof of possession of the recovery key that the forgot-password flow sends (independent of the wrap key). */
export async function deriveRecoveryAuth(recoveryKey: Bytes): Promise<{ raw: Bytes; text: string }> {
  const raw = await hkdf(recoveryKey, utf8(LABEL.recoveryAuth), AUTH_BYTES);
  return { raw, text: toBase64Url(raw) };
}

function randomBelow(limit: number): number {
  const usable = 256 - (256 % limit);
  for (;;) {
    const [byte] = crypto.getRandomValues(new Uint8Array(1));
    if (byte < usable) {
      return byte % limit;
    }
  }
}

/**
 * Which 3 groups (0-based, of 9) a person must type back to prove they saw the key: distinct, no two adjacent (35 possible sets), drawn
 * with the CSPRNG by rejection sampling. Draw again at every attempt.
 */
export function drawConfirmationGroups(): [number, number, number] {
  for (;;) {
    const picked = [randomBelow(GROUPS), randomBelow(GROUPS), randomBelow(GROUPS)].toSorted((a, b) => a - b);
    if (picked[1] - picked[0] >= 2 && picked[2] - picked[1] >= 2) {
      return [picked[0], picked[1], picked[2]];
    }
  }
}

/** True when each typed group equals the displayed group at the same position, after the decoder's normalisation. */
export function confirmationMatches(displayed: string, indexes: readonly number[], typed: readonly string[]): boolean {
  const shown = normalizeRecoveryText(displayed);
  return (
    indexes.length === typed.length &&
    indexes.every((index, position) => {
      const written = normalizeRecoveryText(typed[position]);
      return written.length === GROUP_SIZE && written === shown.slice(index * GROUP_SIZE, (index + 1) * GROUP_SIZE);
    })
  );
}
