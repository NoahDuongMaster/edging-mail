import { esc } from '../html';
import { icon, type IconName } from './icons';
import { windowDots } from './windowDots';

/**
 * The product screenshot in an app window: a window bar (three neutral dots and the address in a pill) above the picture, a hairline,
 * radius 12 and the large shadow; the accent glow behind it comes from CSS. The picture follows the visitor's light or dark setting.
 * On a small tablet CSS crops the same file to its left part (folders and list), and on a phone to the message list alone at
 * a readable size, instead of shrinking the whole window.
 */
export function productFrame(frame: {
  readonly light: string;
  readonly dark: string;
  readonly width: number;
  readonly height: number;
  readonly alt: string;
  readonly address: string;
}): string {
  const size = `width="${frame.width}" height="${frame.height}"`;
  return `<div class="frame"><div class="frame-bar" aria-hidden="true">${windowDots()}<span class="url">${icon('lock')}<span>${esc(frame.address)}</span></span></div><picture>
          <source media="(prefers-color-scheme: dark)" srcset="${frame.dark}" ${size}>
          <img src="${frame.light}" ${size} alt="${esc(frame.alt)}" loading="eager" fetchpriority="high" decoding="async">
        </picture></div>`;
}

/** The Cloudflare products the app runs on, as quiet text marks with a small geometric glyph each (no company logos). */
const PLATFORM: readonly (readonly [IconName, string])[] = [
  ['hexagon', 'Cloudflare Workers'],
  ['database', 'D1'],
  ['bucket', 'R2'],
  ['route', 'Email Routing'],
  ['objects', 'Durable Objects']
];

/** The strip under the hero: "Built on" and the platform's products between two hairlines. */
export const techStrip = (label: string): string =>
  `<div class="strip"><div class="wrap strip-row"><p class="strip-label">${esc(label)}</p><ul class="marks">${PLATFORM.map(([name, text]) => `<li>${icon(name)}${esc(text)}</li>`).join('')}</ul></div></div>`;
