import type { Card, LandingCopy } from './copy.types';
import { esc } from './html';
import { LANGUAGES, languageOf } from './languages';
import { LANDING_CSS } from './landing.css';
import { APP_PATH, BRAND_NAME, DEPLOY_GUIDE_URL, GITHUB_URL, LICENSE_URL } from './links';
import { seoTags } from './seo';

// One template for every language: the words come from copy.vi.ts / copy.en.ts / copy.zh.ts, the markup and the style live here.
// The page is complete HTML with no script needed to read it: one h1, an h2 per section, h3 for the cards and questions.

// The sign-in button hands the page's language to the app (`?lang=`), which uses it before anyone has signed in.
const signInButton = (copy: LandingCopy, primary: boolean): string =>
  `<a class="btn${primary ? ' btn-primary' : ''}" href="${APP_PATH}?lang=${languageOf(copy.lang).app}">${esc(copy.cta.signIn)}</a>`;

// The deploy guide is English only, which the Vietnamese page says in a small note under the button.
const deployButton = (copy: LandingCopy, primary: boolean): string => {
  const note = copy.cta.deployNote === undefined ? '' : `<span class="note">${esc(copy.cta.deployNote)}</span>`;
  return `<div class="cta-alt"><a class="btn${primary ? ' btn-primary' : ''}" href="${esc(DEPLOY_GUIDE_URL)}" rel="noopener">${esc(copy.cta.deploy)}</a>${note}</div>`;
};

const cards = (items: readonly Card[], tag: 'article' | 'li', className = 'card'): string =>
  items.map((item) => `<${tag} class="${className}"><h3>${esc(item.title)}</h3><p>${esc(item.text)}</p></${tag}>`).join('\n        ');

const section = (id: string, heading: string, body: string): string =>
  `<section class="band" aria-labelledby="${id}">
      <div class="wrap">
        <h2 id="${id}">${esc(heading)}</h2>
        ${body}
      </div>
    </section>`;

// Security: two titled groups side by side on a wide screen, then the one sentence about what encryption does not cover.
const securitySection = (copy: LandingCopy): string => {
  const groups = copy.security.groups
    .map(
      (group) =>
        `<article class="card"><h3>${esc(group.title)}</h3><ul class="checks">${group.items.map((item) => `<li>${esc(item)}</li>`).join('')}</ul></article>`
    )
    .join('\n        ');
  return section(
    'security',
    copy.security.h2,
    `<div class="grid">${groups}</div>\n        <p class="caveat">${esc(copy.security.closing)}</p>`
  );
};

// The last call to action sits in one calm panel: the deploy guide is the main button here, signing in the second.
const closingSection = (copy: LandingCopy): string =>
  `<section class="band closing" aria-labelledby="closing">
      <div class="wrap">
        <div class="panel">
          <h2 id="closing">${esc(copy.closing.h2)}</h2>
          <p>${esc(copy.closing.text)}</p>
          <div class="cta">${deployButton(copy, true)}${signInButton(copy, false)}</div>
        </div>
      </div>
    </section>`;

// A link to another language's page. The language name stays in its own language and is marked as such for screen readers.
const languageLink = (language: (typeof LANGUAGES)[number], className?: string): string =>
  `<a${className === undefined ? '' : ` class="${className}"`} href="${language.path}" hreflang="${language.lang}" lang="${language.lang}">${esc(language.label)}</a>`;

function header(copy: LandingCopy): string {
  const others = LANGUAGES.filter((language) => language.lang !== copy.lang);
  return `<header class="top">
    <div class="wrap">
      <a class="brand" href="${copy.path}"><img src="/logo.svg?v=2" width="32" height="32" alt="">${BRAND_NAME}</a>
      <div class="langs">${others.map((language) => languageLink(language, 'lang')).join('')}</div>
    </div>
  </header>`;
}

function hero(copy: LandingCopy): string {
  return `<section class="hero">
      <div class="wrap hero-grid">
        <div>
          <h1>${esc(copy.hero.h1)}</h1>
          <p class="lead">${esc(copy.hero.subline)}</p>
          <div class="cta">${signInButton(copy, true)}${deployButton(copy, false)}</div>
        </div>
        <img class="mascot" src="/edgar.svg" width="484" height="471" alt="${esc(copy.hero.mascotAlt)}">
      </div>
    </section>`;
}

// The footer switch lists every language; the one being read is plain text marked as the current one.
function footer(copy: LandingCopy): string {
  const languages = LANGUAGES.map((language) =>
    language.lang === copy.lang
      ? `<li><span aria-current="true" lang="${language.lang}">${esc(language.label)}</span></li>`
      : `<li>${languageLink(language)}</li>`
  ).join('\n        ');
  return `<footer class="foot">
    <div class="wrap">
      <p>${esc(copy.footer.text)}</p>
      <ul>
        <li><a href="${esc(GITHUB_URL)}" rel="noopener">${esc(copy.chrome.githubLink)}</a></li>
        <li><a href="${esc(LICENSE_URL)}" rel="noopener">${esc(copy.chrome.licenseLink)}</a></li>
        ${languages}
      </ul>
    </div>
  </footer>`;
}

/**
 * The whole page for one language. `origin` is the origin the request came in on: it makes every absolute URL (canonical,
 * language alternates, card image, structured data) right on any host. Only the Vietnamese page, the one at "/", carries the
 * small script that sends an installed app on to /app.
 */
export function renderLanding(copy: LandingCopy, origin: string): string {
  const { benefits, features, how, faq } = copy;
  const standalone = copy.path === '/' ? '\n    <script src="/standalone.js" defer></script>' : '';
  return `<!doctype html>
<html lang="${copy.lang}">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    ${seoTags(copy, origin)}
    <meta name="color-scheme" content="light dark">
    <meta name="theme-color" content="#f4f5f7" media="(prefers-color-scheme: light)">
    <meta name="theme-color" content="#0d0f13" media="(prefers-color-scheme: dark)">
    <link rel="icon" href="/favicon.ico?v=2" sizes="48x48">
    <link rel="icon" type="image/svg+xml" href="/logo.svg?v=2">
    <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">
    <link rel="manifest" href="/manifest.webmanifest">
    <style>${LANDING_CSS}</style>${standalone}
  </head>
  <body>
  <a class="skip" href="#main">${esc(copy.chrome.skipLink)}</a>
  ${header(copy)}
  <main id="main" tabindex="-1">
    ${hero(copy)}
    ${section('benefits', benefits.h2, `<div class="grid">${cards(benefits.cards, 'article')}</div>`)}
    ${section('features', features.h2, `<div class="grid">${cards(features.cards, 'article')}</div>`)}
    ${section(
      'how',
      how.h2,
      `<p class="sub">${esc(how.lead)}</p>
        <ol class="grid">${cards(how.steps, 'li', 'card step')}</ol>`
    )}
    ${securitySection(copy)}
    ${section(
      'faq',
      faq.h2,
      `<p class="sub">${esc(faq.lead)}</p>
        <div class="faq">${faq.items.map((item) => `<div><h3>${esc(item.question)}</h3><p>${esc(item.answer)}</p></div>`).join('')}</div>`
    )}
    ${closingSection(copy)}
  </main>
  ${footer(copy)}
  </body>
</html>
`;
}
