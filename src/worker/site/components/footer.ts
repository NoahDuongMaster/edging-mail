import type { LandingCopy } from '../copy.types';
import { esc } from '../html';
import { LANGUAGES } from '../languages';
import { DEPLOY_GUIDE_URL, GITHUB_URL, LICENSE_URL } from '../links';
import { pill } from './badge';
import { signInHref } from './button';
import { icon } from './icons';
import { brandLink, languageLink } from './nav';

const column = (title: string, items: readonly string[]): string =>
  `<div class="foot-col"><p class="foot-title">${esc(title)}</p><ul>${items.map((item) => `<li>${item}</li>`).join('')}</ul></div>`;

/**
 * The footer: the logo with the small print under it, three columns of links that exist (the product: sign in and the deploy guide;
 * the open-source project: GitHub and the licence; the languages, the current one as plain text marked current), and a bottom row
 * under a hairline with the two facts of the hero as quiet text.
 */
export function footer(copy: LandingCopy): string {
  const { ui } = copy;
  const [licence, platform] = ui.heroPills;
  const languages = LANGUAGES.map((language) =>
    language.lang === copy.lang
      ? `<span aria-current="true" lang="${language.lang}">${esc(language.label)}${icon('check')}</span>`
      : languageLink(language)
  );
  return `<footer class="foot">
    <div class="wrap foot-grid">
      <div class="foot-brand">${brandLink(copy)}<p class="foot-about">${esc(copy.footer.text)}</p></div>
      ${column(ui.footer.product, [
        `<a href="${signInHref(copy)}">${esc(copy.cta.signIn)}</a>`,
        `<a href="${esc(DEPLOY_GUIDE_URL)}" rel="noopener">${esc(ui.footer.deployGuide)}</a>`
      ])}
      ${column(ui.footer.project, [
        `<a href="${esc(GITHUB_URL)}" rel="noopener">${esc(copy.chrome.githubLink)}</a>`,
        `<a href="${esc(LICENSE_URL)}" rel="noopener">${esc(copy.chrome.licenseLink)}</a>`
      ])}
      ${column(copy.chrome.languageLabel, languages)}
    </div>
    <div class="wrap foot-bottom"><p class="foot-pills">${pill('code', licence)}${pill('cloud', platform)}</p></div>
  </footer>`;
}
