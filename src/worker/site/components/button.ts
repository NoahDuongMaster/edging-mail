import type { LandingCopy } from '../copy.types';
import { esc } from '../html';
import { languageOf } from '../languages';
import { APP_PATH, DEPLOY_GUIDE_URL } from '../links';

/** The three looks of a call to action: the one main action of a block, the second one beside it, the compact one of the top bar. */
export type ButtonKind = 'primary' | 'secondary' | 'small';

const BUTTON_CLASS: Record<ButtonKind, string> = { primary: 'btn btn-primary', secondary: 'btn', small: 'btn btn-sm' };

/**
 * A link that looks like a button. Use it for the page's calls to action only (sign in, deploy); a link inside text, the navigation
 * or the footer stays a plain link. The label is escaped here.
 */
export const buttonLink = (kind: ButtonKind, href: string, label: string, rel?: 'noopener'): string =>
  `<a class="${BUTTON_CLASS[kind]}" href="${esc(href)}"${rel === undefined ? '' : ` rel="${rel}"`}>${esc(label)}</a>`;

/** Where signing in starts: the app, told the page's language (`?lang=`) so it speaks it before anyone has signed in. */
export const signInHref = (copy: LandingCopy): string => `${APP_PATH}?lang=${languageOf(copy.lang).app}`;

/** The sign-in call to action (top bar: `small`, hero: `primary`, closing band: `secondary`). */
export const signInButton = (copy: LandingCopy, kind: ButtonKind): string => buttonLink(kind, signInHref(copy), copy.cta.signIn);

/**
 * The deploy call to action. The guide is in English only, which the Vietnamese and Chinese pages say in a small note under the
 * button (`cta.deployNote`); the English page has no note.
 */
export function deployButton(copy: LandingCopy, primary: boolean): string {
  const note = copy.cta.deployNote === undefined ? '' : `<span class="note">${esc(copy.cta.deployNote)}</span>`;
  return `<div class="cta-alt">${buttonLink(primary ? 'primary' : 'secondary', DEPLOY_GUIDE_URL, copy.cta.deploy, 'noopener')}${note}</div>`;
}
