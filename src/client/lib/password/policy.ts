import { PASSWORD_MIN_CODE_POINTS } from '../../../shared/crypto/constants';

export { PASSWORD_MAX_CODE_POINTS as MAX_LENGTH, PASSWORD_MIN_CODE_POINTS as MEMBER_MIN_LENGTH } from '../../../shared/crypto/constants';

// The password rules of the app (crypto-design.md section 3 and design.md section 16): counted in Unicode code points after NFKC, so the
// same password typed on any keyboard has the same length and the same bytes. The server never sees a password, so this is the only
// place that enforces them. The member minimum and the maximum are the shared constants; the admin minimum is a product rule.

export type PasswordRole = 'member' | 'admin';

export const ADMIN_MIN_LENGTH = 16;

export const minLengthFor = (role: PasswordRole): number => (role === 'admin' ? ADMIN_MIN_LENGTH : PASSWORD_MIN_CODE_POINTS);

export const normalizePassword = (password: string): string => password.normalize('NFKC');

/** The text as an array of Unicode code points (an emoji is one entry). The rules count these, not UTF-16 units. */
export function codePoints(text: string): string[] {
  const points: string[] = [];
  // Iterating a string yields one entry per code point, which is what `.split('')` and `.length` get wrong.
  for (const point of text) {
    points.push(point);
  }
  return points;
}

/** Characters as the rules count them: code points after NFKC (an emoji counts once, a ligature may count twice). */
export const passwordLength = (password: string): number => codePoints(normalizePassword(password)).length;

/**
 * Words from the account that must not be inside its password: the parts of the address before the @ (longer than three letters), the first
 * label of its domain and the words of the display name. Lower case, no duplicates.
 */
export function contextWords(address: string, displayName = ''): string[] {
  const [local = '', domain = ''] = address.trim().toLowerCase().split('@', 2);
  const words = new Set<string>();
  const add = (word: string) => {
    if (codePoints(word).length > 3) {
      words.add(word);
    }
  };
  add(local);
  for (const part of local.split(/[._+-]+/)) {
    add(part);
  }
  const label = domain.split('.', 1)[0] ?? '';
  add(label);
  for (const part of label.split(/[_-]+/)) {
    add(part);
  }
  for (const part of normalizePassword(displayName).toLowerCase().split(/\s+/)) {
    add(part);
  }
  return [...words];
}
