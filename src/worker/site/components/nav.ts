import type { LandingCopy } from '../copy.types';
import { esc } from '../html';
import { LANGUAGES, type Language } from '../languages';
import { BRAND_NAME, GITHUB_URL } from '../links';
import { signInButton } from './button';
import { githubMark, icon } from './icons';

/** The ids of the section headings the top bar links to (the h2 ids the sections are labelled by). */
const SECTION_LINKS = [
  ['features', 'features'],
  ['security', 'security'],
  ['how', 'how'],
  ['faq', 'faq']
] as const;

/** The logo tile (28 px) and the wordmark, linking to the top of the page's own language. */
export const brandLink = (copy: LandingCopy): string =>
  `<a class="brand" href="${copy.path}"><img src="/logo.svg?v=2" width="28" height="28" alt=""><span class="brand-name">${BRAND_NAME}</span></a>`;

/** A link to another language's page. The language name stays in its own language and is marked as such for screen readers. */
export const languageLink = (language: Language): string =>
  `<a href="${language.path}" hreflang="${language.lang}" lang="${language.lang}">${esc(language.label)}</a>`;

/**
 * The language switch as a small menu (`<details>`): the button shows a globe and the current language, the panel lists every language
 * in a fixed order, the one being read marked as current (plain text with a check, not a link). On a phone the button is the globe
 * alone (44 px). Opening it closes the phone menu (same `name`).
 */
function languageMenu(copy: LandingCopy): string {
  const current = LANGUAGES.find((language) => language.lang === copy.lang);
  const items = LANGUAGES.map((language) =>
    language.lang === copy.lang
      ? `<span aria-current="true" lang="${language.lang}">${esc(language.label)}${icon('check')}</span>`
      : languageLink(language)
  ).join('');
  return `<details class="drop lang" name="top-menu"><summary>${icon('globe')}<span class="vh">${esc(copy.chrome.languageLabel)}</span><span class="lang-name">${esc(current?.label ?? '')}</span>${icon('chevronDown', { className: 'chev' })}</summary><div class="pop"><nav class="seg" aria-label="${esc(copy.chrome.languageLabel)}">${items}</nav></div></details>`;
}

const sectionLinks = (copy: LandingCopy, className: string): string =>
  SECTION_LINKS.map(([id, key]) => `<a class="${className}" href="#${id}">${esc(copy.ui.nav[key])}</a>`).join('');

const githubLink = (copy: LandingCopy, className: string): string =>
  `<a class="${className}" href="${esc(GITHUB_URL)}" rel="noopener">${githubMark()}<span>${esc(copy.chrome.githubLink)}</span></a>`;

/**
 * The sticky top bar: logo and wordmark, the section links (desktop), GitHub, the language menu and the Sign in button. Below a
 * desktop width the section links (and, on a phone, GitHub) move into a menu button (`<details>`, 44 px). Nothing here needs a script.
 */
export function topBar(copy: LandingCopy): string {
  const { nav } = copy.ui;
  return `<header class="top">
    <div class="wrap bar">
      ${brandLink(copy)}
      <nav class="links" aria-label="${esc(nav.label)}">${sectionLinks(copy, 'nav-link')}</nav>
      ${githubLink(copy, 'nav-link gh')}
      ${languageMenu(copy)}
      ${signInButton(copy, 'small')}
      <details class="drop menu" name="top-menu"><summary aria-label="${esc(nav.menu)}">${icon('menu')}</summary><div class="pop"><nav class="menu-links" aria-label="${esc(nav.label)}">${sectionLinks(copy, 'menu-link')}<span class="menu-sep"></span>${githubLink(copy, 'menu-link menu-gh')}</nav></div></details>
    </div>
  </header>`;
}
