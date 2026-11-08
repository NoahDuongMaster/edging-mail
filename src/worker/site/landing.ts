import { DARK, FONT_FILES, LIGHT } from '../../shared/design/tokens';
import {
  accordion,
  adminFragment,
  archDiagram,
  band,
  bento,
  bentoTile,
  callout,
  card,
  cardRow,
  checkGroup,
  checkLegend,
  codeBlock,
  composeFragment,
  deployButton,
  domainFragment,
  footer,
  icon,
  keyFragment,
  licenceFragment,
  mailboxFragment,
  newMailFragment,
  phoneFragment,
  pill,
  productFrame,
  sectionHeader,
  signInButton,
  stackFragment,
  stepper,
  techStrip,
  topBar,
  type CheckKind,
  type CommandGroup,
  type TileShape
} from './components';
import type { LandingCopy } from './copy.types';
import { esc } from './html';
import { languageOf } from './languages';
import { LANDING_CSS } from './landing.css';
import { DEPLOY_GUIDE_URL } from './links';
import { seoTags } from './seo';

// One template for every language: the words come from copy.vi.ts / copy.en.ts / copy.zh.ts, the markup lives in components/ and
// the style in landing.css.ts. The page is complete HTML with no script needed to read it: one h1, an h2 per section, h3 for the
// points, tiles, steps, groups and questions. Surface: Decide / Learn, restrained in colour and rich in product: every section
// has its own composition (cards with visuals, a bento of app fragments, steps beside a terminal, a diagram beside the lists, an
// accordion, a closing panel).

/**
 * The product screenshot in the hero. Both files of a language live in public/landing as `app-light.<lang>.png` and
 * `app-dark.<lang>.png` (lang = vi, en, zh) and have these pixel sizes: 1440 x 900, a 16:10 window. The size is only the aspect
 * ratio and the sharpness: CSS scales the image to the width of the page. If a screenshot is retaken at another size with the
 * same ratio (2880 x 1800 for a sharper one), change these two numbers and nothing else.
 */
const SCREENSHOT_PATH = '/landing';
const SCREENSHOT_WIDTH = 1440;
const SCREENSHOT_HEIGHT = 900;

/** The shape of each feature tile, in the order of `features.cards` (folders, write, new mail, phone, encryption, accounts). */
const TILE_SHAPES: readonly TileShape[] = ['wide', 'small', 'small', 'phone', 'small', 'full'];

/**
 * What each statement of the Security groups is, in the order of `security.groups[].items` (the same in every language): a guarantee
 * gets a check, a limit (what is not encrypted, what an admin can still do, what is lost for good) gets the neutral info mark.
 */
export const SECURITY_KINDS: readonly (readonly CheckKind[])[] = [
  ['protected', 'protected', 'limit', 'limit', 'limit', 'limit'],
  ['protected', 'limit', 'protected', 'limit', 'limit'],
  ['protected', 'protected', 'protected', 'protected']
];

/**
 * The deploy commands, exactly as docs/deployment.md writes them (steps 2 to 5: database and bucket, migrations, the three secrets,
 * deploy). The comment over each group comes from the copy.
 */
const DEPLOY_COMMANDS: readonly (readonly string[])[] = [
  ['npx wrangler d1 create edging_mail_db', 'npx wrangler r2 bucket create edging-mail-storage'],
  ['npm run db:migrate:remote'],
  ['npx wrangler secret put JWT_SECRET', 'npx wrangler secret put DATA_KEY', 'npx wrangler secret put APP_PASSWORD'],
  ['npm run deploy']
];

// The headline, the facts in pills, the lead and the two buttons, left-aligned over a faint grid, then the product in an app window
// with a soft accent glow behind it. The screenshot is the first image of the page, so it loads at once and has its size.
function hero(copy: LandingCopy): string {
  const { app } = languageOf(copy.lang);
  const [licence, platform] = copy.ui.heroPills;
  return `<section class="hero">
      <div class="wrap hero-grid">
        <p class="pills">${pill('code', licence)}${pill('cloud', platform)}</p>
        <h1>${esc(copy.hero.h1)}</h1>
        <div class="hero-side">
          <p class="lead">${esc(copy.hero.subline)}</p>
          <div class="cta">${signInButton(copy, 'primary')}${deployButton(copy, false)}</div>
        </div>
      </div>
      <div class="wrap shot">
        ${productFrame({
          light: `${SCREENSHOT_PATH}/app-light.${app}.png`,
          dark: `${SCREENSHOT_PATH}/app-dark.${app}.png`,
          width: SCREENSHOT_WIDTH,
          height: SCREENSHOT_HEIGHT,
          alt: copy.hero.screenshotAlt,
          address: `mail.${copy.ui.sampleDomain}`
        })}
      </div>
    </section>`;
}

// The three ways the company keeps its email, each with its own small picture: the domain and its addresses, the Cloudflare account
// that holds everything, the licence file.
function benefitsSection(copy: LandingCopy): string {
  const visuals = [domainFragment(copy.ui), stackFragment(copy.ui), licenceFragment()];
  const cards = copy.benefits.cards.map((item, index) => card(item, visuals[index] ?? ''));
  return band(
    'benefits',
    'alt',
    `${sectionHeader({ id: 'benefits', eyebrow: copy.ui.eyebrows.benefits, title: copy.benefits.h2 })}\n        ${cardRow(cards)}`
  );
}

// The six features as a bento: every tile carries a fragment of the app built from the same tokens.
function featuresSection(copy: LandingCopy): string {
  const { ui } = copy;
  const fragments = [mailboxFragment(ui), composeFragment(ui), newMailFragment(ui), phoneFragment(ui), keyFragment(ui), adminFragment(ui)];
  const tiles = copy.features.cards.map((item, index) => bentoTile(item, index, TILE_SHAPES[index] ?? 'small', fragments[index] ?? ''));
  return band(
    'features',
    'plain',
    `${sectionHeader({ id: 'features', eyebrow: ui.eyebrows.features, title: copy.features.h2 })}\n        ${bento(tiles)}`
  );
}

// The setup, in the order it happens: the deploy commands the IT person runs first (from a terminal, the starting point), then the
// lead and the three steps that follow once the app is deployed. On a phone the terminal comes first as well.
function howSection(copy: LandingCopy): string {
  const { code } = copy.ui;
  const groups: CommandGroup[] = DEPLOY_COMMANDS.map((commands, index) => ({ comment: code.comments[index] ?? '', commands }));
  const terminal = `<div class="how-code"><p class="code-caption"><span class="step-num step-start" aria-hidden="true">${icon('terminal')}</span><span>${esc(code.caption)}</span></p>${codeBlock({ title: code.title, label: code.title, groups })}<a class="guide" href="${esc(DEPLOY_GUIDE_URL)}" rel="noopener">${esc(code.guideLink)}${icon('arrowRight')}</a></div>`;
  const steps = `<div class="how-steps"><p class="sub how-lead">${esc(copy.how.lead)}</p>${stepper(copy.how.steps)}</div>`;
  return band(
    'how',
    'alt',
    `${sectionHeader({ id: 'how', eyebrow: copy.ui.eyebrows.how, title: copy.how.h2 })}
        <div class="how">${terminal}${steps}</div>`
  );
}

// Who can see what: the diagram is the centrepiece, full width (where the key is, what the Worker can and cannot do, what is
// stored), with the key to the list marks beside its caption. Under it the three groups of statements in two columns (guarantees
// as plain rows, limits on a quiet fill with the warning mark), and the one caveat about the software as wide as the section, last.
function securitySection(copy: LandingCopy): string {
  const { diagram, legend, words } = copy.ui;
  const figure = archDiagram({
    caption: diagram.caption,
    zone: words.cloudflareAccount,
    browser: { ...diagram.browser, glyph: 'key', tagIcon: 'key', key: true },
    worker: { ...diagram.worker, glyph: 'hexagon', tagIcon: 'lock' },
    storage: { ...diagram.storage, glyph: 'database', tagIcon: 'lock' },
    aside: checkLegend(legend)
  });
  const groups = copy.security.groups.map((group, index) => checkGroup(group, SECURITY_KINDS[index] ?? [], legend)).join('');
  return band(
    'security',
    'plain',
    `${sectionHeader({ id: 'security', eyebrow: copy.ui.eyebrows.security, title: copy.security.h2 })}
        ${figure}
        <div class="groups">${groups}</div>
        ${callout('warning', copy.security.closing)}`
  );
}

// The questions: the header stays in view in its column, the answers open beside it.
const faqSection = (copy: LandingCopy): string =>
  band(
    'faq',
    'alt',
    `<div class="split"><div class="split-head">${sectionHeader({ id: 'faq', eyebrow: copy.ui.eyebrows.faq, title: copy.faq.h2, sub: copy.faq.lead })}</div>${accordion(copy.faq.items)}</div>`
  );

// The last call to action is the page's one high-contrast moment: a full-bleed band in the dark palette (the inverse of a light
// page; on a dark page an accent-tinted deep band, since a light slab there reads as a theme bug), a heading larger than the
// section headings, and the two buttons drawn for that surface. The deploy guide is the main button here, signing in the second
// (prospects reach this band; staff sign in from the hero).
const closingSection = (copy: LandingCopy): string =>
  band(
    'closing',
    'plain',
    `<div class="closing-inner">
          <div class="closing-text"><h2 id="closing">${esc(copy.closing.h2)}</h2><p>${esc(copy.closing.text)}</p></div>
          <div class="cta">${deployButton(copy, true)}${signInButton(copy, 'secondary')}</div>
        </div>`,
    'closing'
  );

/**
 * The whole page for one language. `origin` is the origin the request came in on: it makes every absolute URL (canonical,
 * language alternates, card image, structured data) right on any host. Only the Vietnamese page, the one at "/", carries the
 * small script that sends an installed app on to /app.
 */
export function renderLanding(copy: LandingCopy, origin: string): string {
  const standalone = copy.path === '/' ? '\n    <script src="/standalone.js" defer></script>' : '';
  return `<!doctype html>
<html lang="${copy.lang}">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    ${seoTags(copy, origin)}
    <meta name="color-scheme" content="light dark">
    <meta name="theme-color" content="${LIGHT.bg}" media="(prefers-color-scheme: light)">
    <meta name="theme-color" content="${DARK.bg}" media="(prefers-color-scheme: dark)">
    <link rel="icon" href="/favicon.ico?v=2" sizes="48x48">
    <link rel="icon" type="image/svg+xml" href="/logo.svg?v=2">
    <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">
    <link rel="manifest" href="/manifest.webmanifest">
    <link rel="preload" href="${FONT_FILES.sans}" as="font" type="font/woff2" crossorigin>
    <style>${LANDING_CSS}</style>${standalone}
  </head>
  <body>
  <a class="skip" href="#main">${esc(copy.chrome.skipLink)}</a>
  ${topBar(copy)}
  <main id="main" tabindex="-1">
    ${hero(copy)}
    ${techStrip(copy.ui.builtOn)}
    ${benefitsSection(copy)}
    ${featuresSection(copy)}
    ${howSection(copy)}
    ${securitySection(copy)}
    ${faqSection(copy)}
    ${closingSection(copy)}
  </main>
  ${footer(copy)}
  </body>
</html>
`;
}
