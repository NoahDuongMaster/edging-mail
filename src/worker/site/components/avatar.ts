import { AVATAR_HUES } from '../../../shared/design/tokens';
import { esc } from '../html';

/** Tone for avatar initials: default muted, accent for selected user/thread, ghost for alias/service. */
export type AvatarTone = 'default' | 'accent' | 'ghost';

/**
 * A compact initials avatar for mockups and UI fragments: the round tile of an ACCOUNT (the admin table, the addresses on a domain, an
 * alias), as the app draws the signed-in person and the admin console's people. A person who writes to you is a stamp instead
 * (`stampAvatar`). Supports tone strings ('default', 'accent', 'ghost') or boolean (true = accent).
 */
export const avatar = (initials: string, tone: AvatarTone | boolean = 'default'): string => {
  const isAccent = tone === true || tone === 'accent';
  const isGhost = tone === 'ghost';
  const toneClass = isAccent ? ' av-a' : isGhost ? ' av-ghost' : '';
  return `<span class="av${toneClass}">${esc(initials)}</span>`;
};

/** FNV-1a over the UTF-16 code units of a string: the hash of the app's avatarHue (src/client/theme.ts), stable on every device. */
function fnv1a(text: string): number {
  let hash = 0x81_1c_9d_c5;
  for (let index = 0; index < text.length; index++) {
    // eslint-disable-next-line unicorn/prefer-code-point -- the hash reads UTF-16 code units, as the app's does
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01_00_01_93) >>> 0;
  }
  return hash;
}

/**
 * The slot in AVATAR_HUES (tokens.ts, the nine person tints) of a sample person: the app's rule (avatarHue: FNV-1a of the trimmed,
 * lower-cased address) applied to the person's name in the form of a company address (`Lena Fischer` -> `lena.fischer`). Names are the
 * same in every language, so a person has one colour on every page; of the natural keys (name, first name, address form) this one puts
 * the fewest neighbouring rows of a fragment in one hue family.
 */
export const stampHue = (name: string): number => fnv1a(name.trim().toLowerCase().replaceAll(/\s+/g, '.')) % AVATAR_HUES.length;

/**
 * A person who writes to you (a sender in a list, the open message's sender, a recipient chip) as the app's v3 postage stamp: perforated
 * paper with the initials printed on a field in the person's tint. The CSS is `.stamp` (ported from the app's
 * `.ui-avatar[data-shape='stamp']`); `name` picks the tint (`stampHue`). Accounts stay round (`avatar`).
 */
export const stampAvatar = (initials: string, name: string): string =>
  `<span class="av stamp" data-hue="${stampHue(name)}">${esc(initials)}</span>`;
