import { esc } from '../html';
import { icon, type IconName } from './icons';

/** The tones a badge may take: plain, the accent (a selected or main thing), success (a check that passed). */
export type BadgeTone = 'neutral' | 'accent' | 'success';

/**
 * A small rounded label inside a product fragment: a role (Admin), a licence (MIT), a passed check (DNS). Use it for a short word
 * that sits next to something else, never as a heading or a button. An optional icon goes in front of the text.
 */
export const badge = (text: string, tone: BadgeTone = 'neutral', iconName?: IconName): string =>
  `<span class="badge badge-${tone}">${iconName === undefined ? '' : icon(iconName)}${esc(text)}</span>`;

/** A fact in a pill above the hero headline (licence, platform): an icon and a few words, not a link. */
export const pill = (iconName: IconName, text: string): string => `<span class="pill">${icon(iconName)}${esc(text)}</span>`;
