import { createExecutionContext } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { handleSite } from '../../src/worker/site';
import { copyEn } from '../../src/worker/site/copy.en';
import { copyVi } from '../../src/worker/site/copy.vi';
import { copyZh } from '../../src/worker/site/copy.zh';
import { SECURITY_KINDS } from '../../src/worker/site/landing';
import { GITHUB_URL } from '../../src/worker/site/links';

/** The deploy commands exactly as docs/deployment.md writes them (steps 2 to 5). */
const DEPLOY_COMMANDS = [
  'npx wrangler d1 create edging_mail_db',
  'npx wrangler r2 bucket create edging-mail-storage',
  'npm run db:migrate:remote',
  'npx wrangler secret put JWT_SECRET',
  'npx wrangler secret put DATA_KEY',
  'npx wrangler secret put APP_PASSWORD',
  'npm run deploy'
];

const ctx = createExecutionContext();
const env = { LANDING_PAGE: 'on' };

async function fetchText(origin: string, path: string): Promise<{ response: Response; text: string }> {
  const response = await handleSite(new Request(`${origin}${path}`), env, ctx, () => Promise.resolve(false));
  if (response === undefined) {
    throw new Error(`${path} is not a site path`);
  }
  return { response, text: await response.text() };
}

const count = (text: string, pattern: RegExp): number => text.match(pattern)?.length ?? 0;

// Titles and descriptions are counted in characters as a reader sees them (graphemes). Chinese is shorter.
const chars = (text: string): number => [...new Intl.Segmenter('und', { granularity: 'grapheme' }).segment(text)].length;

const PAGES = [
  { name: 'vi', path: '/', copy: copyVi, lang: 'vi', app: 'vi', locale: 'vi_VN', alternateLocales: ['en_US', 'zh_CN'], limits: [60, 160] },
  {
    name: 'en',
    path: '/en/',
    copy: copyEn,
    lang: 'en',
    app: 'en',
    locale: 'en_US',
    alternateLocales: ['vi_VN', 'zh_CN'],
    limits: [60, 160]
  },
  {
    name: 'zh',
    path: '/zh/',
    copy: copyZh,
    lang: 'zh-CN',
    app: 'zh',
    locale: 'zh_CN',
    alternateLocales: ['vi_VN', 'en_US'],
    limits: [30, 80]
  }
] as const;

describe.each(PAGES)('landing page ($name)', ({ path, copy, lang, app, locale, alternateLocales, limits }) => {
  const origin = 'https://mail.example.com';

  it('is complete HTML with one h1, an h2 per section and a skip link', async () => {
    const { text } = await fetchText(origin, path);
    expect(text.startsWith('<!doctype html>')).toBe(true);
    expect(text).toContain(`<html lang="${lang}">`);
    expect(count(text, /<h1[ >]/g)).toBe(1);
    expect(count(text, /<h2[ >]/g)).toBe(6);
    expect(count(text, /<h3[ >]/g)).toBe(
      copy.benefits.cards.length + copy.features.cards.length + copy.how.steps.length + copy.security.groups.length + copy.faq.items.length
    );
    expect(text).toContain('class="skip" href="#main"');
    expect(text).toContain('<main id="main" tabindex="-1">');
    expect(text).toContain('<meta name="viewport" content="width=device-width, initial-scale=1">');
    // Every image has its size and a text alternative.
    for (const image of text.match(/<img [^>]*>/g) ?? []) {
      expect(image).toMatch(/width="\d+"/);
      expect(image).toMatch(/height="\d+"/);
      expect(image).toMatch(/alt="/);
    }
  });

  it('puts all of the approved copy on the page', async () => {
    const { text } = await fetchText(origin, path);
    const html = text.replaceAll('&#39;', "'");
    // The page may set the first clause of a statement in its own element (the security rows do), so the words are compared
    // as text: every approved sentence must still be on the page, word for word and in order.
    const words = html.replaceAll(/<[^>]+>/g, '');
    const sentences = [
      copy.hero.h1,
      copy.hero.subline,
      copy.cta.signIn,
      copy.cta.deploy,
      copy.benefits.h2,
      ...copy.benefits.cards.flatMap((card) => [card.title, card.text]),
      copy.features.h2,
      ...copy.features.cards.flatMap((card) => [card.title, card.text]),
      copy.how.h2,
      copy.how.lead,
      ...copy.how.steps.flatMap((step) => [step.title, step.text]),
      copy.security.h2,
      ...copy.security.groups.flatMap((group) => [group.title, ...group.items]),
      copy.security.closing,
      copy.faq.h2,
      copy.faq.lead,
      ...copy.faq.items.flatMap((item) => [item.question, item.answer]),
      copy.closing.h2,
      copy.closing.text,
      copy.footer.text
    ];
    for (const sentence of sentences) {
      expect(words).toContain(sentence);
    }
  });

  it('has a title and a description within the limits of its language', () => {
    expect(chars(copy.meta.title)).toBeLessThanOrEqual(limits[0]);
    expect(chars(copy.meta.description)).toBeLessThanOrEqual(limits[1]);
  });

  it('has the Security section in three titled groups and seven FAQ questions', async () => {
    const { text } = await fetchText(origin, path);
    expect(copy.security.groups.map((group) => group.items.length)).toEqual([6, 5, 4]);
    expect(copy.faq.items).toHaveLength(7);
    // Every group is an h3 with its own list; the FAQ questions are h3 as well.
    expect(count(text, /<ul class="checks">/g)).toBe(3);
    for (const group of copy.security.groups) {
      expect(text).toContain(`<h3>${group.title}</h3>`);
    }
  });

  it('has a nav whose links reach the sections, and the language and phone menus as disclosures (no script, no button)', async () => {
    const { text } = await fetchText(origin, path);
    const header = /<header[\s\S]*?<\/header>/.exec(text)?.[0] ?? '';
    for (const id of ['features', 'security', 'how', 'faq']) {
      expect(header).toContain(`<a class="nav-link" href="#${id}">`);
      expect(text).toContain(`<h2 id="${id}"`);
    }
    expect(count(header, /<details class="drop (lang|menu)" name="top-menu">/g)).toBe(2);
    expect(text).not.toContain('<button');
  });

  it('draws the product as decoration: every fragment of the benefits and the bento is hidden from screen readers', async () => {
    const { text } = await fetchText(origin, path);
    expect(count(text, /<article class="tile tile-(wide|full|phone|small) tile-[a-f]">/g)).toBe(copy.features.cards.length);
    expect(count(text, /<div class="tile-art" aria-hidden="true">/g)).toBe(copy.features.cards.length);
    expect(count(text, /<div class="card-visual" aria-hidden="true">/g)).toBe(copy.benefits.cards.length);
    // The fragments speak the product's own words: the folder list is the glossary's, in the page's language.
    for (const folder of Object.values(copy.ui.folders)) {
      expect(text).toContain(folder);
    }
  });

  it('shows the deploy commands of docs/deployment.md in a terminal that scrolls sideways, with no copy button', async () => {
    const { text } = await fetchText(origin, path);
    const terminal = /<pre tabindex="0" aria-label="[^"]+">[\s\S]*?<\/pre>/.exec(text)?.[0] ?? '';
    const lines = terminal.replaceAll(/<[^>]+>/g, '').split('\n');
    for (const command of DEPLOY_COMMANDS) {
      expect(lines).toContain(command);
    }
    expect(text).not.toMatch(/clipboard/i);
  });

  it('marks a guarantee with a check and a limit with the warning mark, never a check, and the caveat as a note', async () => {
    const { text } = await fetchText(origin, path);
    const lists = text.match(/<ul class="checks">[\s\S]*?<\/ul>/g) ?? [];
    expect(lists).toHaveLength(SECURITY_KINDS.length);
    for (const [index, list] of lists.entries()) {
      expect([...list.matchAll(/<li class="is-(protected|limit)">/g)].map((match) => match[1])).toEqual(SECURITY_KINDS[index]);
    }
    for (const item of text.match(/<li class="is-limit">[\s\S]*?<\/li>/g) ?? []) {
      expect(item).toContain(`class="ic mark mark-limit"`);
      expect(item).toContain(`aria-label="${copy.ui.legend.limit}"`);
      expect(item).not.toContain('mark-protected');
    }
    expect(text).toContain('<div class="callout callout-warning" role="note">');
  });

  it('answers every question in a disclosure whose summary is the h3, the first one open', async () => {
    const { text } = await fetchText(origin, path);
    expect(count(text, /<details class="qa"( open)?><summary><h3>/g)).toBe(copy.faq.items.length);
    expect(count(text, /<details class="qa" open>/g)).toBe(1);
  });

  it('shows the product, not the mascot, in the hero: a light and a dark screenshot with their size, loaded at once', async () => {
    const { text } = await fetchText(origin, path);
    const hero = /<section class="hero">[\s\S]*?<\/section>/.exec(text)?.[0] ?? '';
    const alt = copy.hero.screenshotAlt.replaceAll("'", '&#39;');
    expect(hero).toContain(`<source media="(prefers-color-scheme: dark)" srcset="/landing/app-dark.${app}.png" width="1440" height="900">`);
    expect(hero).toContain(`<img src="/landing/app-light.${app}.png" width="1440" height="900" alt="${alt}" loading="eager"`);
    // The screenshot is the hero's one image; the other two are the logo beside the brand name in the header and in the footer.
    expect(count(hero, /<img /g)).toBe(1);
    expect(count(text, /<img /g)).toBe(3);
    expect(count(text, /<img src="\/logo\.svg\?v=2" width="28" height="28" alt="">/g)).toBe(2);
    expect(text).not.toContain('edgar.svg');
    // The frame may have a faint glow behind it, but text is never painted with a gradient.
    expect(text).not.toMatch(/background-clip:\s*text|text-fill-color/i);
  });

  it('never uses the retired recovery wording (nobody, admins included, can reset or read)', async () => {
    const { text } = await fetchText(origin, path);
    // Built from pieces so that a repository-wide search for these phrases finds only copy that is wrong, never this list.
    const retired = [
      ['admin', 'assisted'].join('-'),
      ['org', 'key'].join(' '),
      ['escr', 'ow'].join(''),
      ['custod', 'ian'].join(''),
      ['reset', 'password'].join('-'),
      ['Admins cannot open', 'staff mail in the app'].join(' '),
      ['admins only through an audi', 'ted reset'].join(''),
      ['Khôi phục qua', 'quản trị viên'].join(' ')
    ];
    for (const phrase of retired) {
      expect(text.toLowerCase()).not.toContain(phrase.toLowerCase());
    }
  });

  it('uses the meta description as the page description and the structured-data description', async () => {
    const { text } = await fetchText(origin, path);
    const html = text.replaceAll('&#39;', "'");
    expect(html).toContain(`<meta name="description" content="${copy.meta.description}">`);
    const raw = /<script type="application\/ld\+json">(.*?)<\/script>/s.exec(text)?.[1] ?? '{}';
    const graph = (JSON.parse(raw) as { '@graph': { '@type': string; description?: string }[] })['@graph'];
    expect(graph.find((node) => node['@type'] === 'SoftwareApplication')?.description).toBe(copy.meta.description);
  });

  it('has canonical, language alternates, Open Graph and Twitter tags built from the request origin', async () => {
    for (const host of ['https://mail.example.com', 'https://example.org', 'http://localhost:8787']) {
      const { text } = await fetchText(host, path);
      expect(text).toContain(`<link rel="canonical" href="${host}${path}">`);
      expect(text).toContain(`<link rel="alternate" hreflang="vi" href="${host}/">`);
      expect(text).toContain(`<link rel="alternate" hreflang="en" href="${host}/en/">`);
      expect(text).toContain(`<link rel="alternate" hreflang="zh-CN" href="${host}/zh/">`);
      expect(text).toContain(`<link rel="alternate" hreflang="x-default" href="${host}/">`);
      expect(text).toContain(`<meta property="og:url" content="${host}${path}">`);
      expect(text).toContain(`<meta property="og:image" content="${host}/og-image.png">`);
      expect(text).toContain(`<meta name="twitter:image" content="${host}/og-image.png">`);
    }
    const { text } = await fetchText(origin, path);
    expect(text).toContain(`<meta property="og:locale" content="${locale}">`);
    for (const alternate of alternateLocales) {
      expect(text).toContain(`<meta property="og:locale:alternate" content="${alternate}">`);
    }
    expect(count(text, /og:locale:alternate/g)).toBe(2);
    expect(text).toContain('<meta property="og:image:width" content="1200">');
    expect(text).toContain('<meta property="og:image:height" content="630">');
    expect(text).toContain('<meta name="twitter:card" content="summary_large_image">');
    expect(text).toContain(`<meta property="og:title" content="${copy.og.title}">`);
    expect(text).toContain(`<title>${copy.meta.title}</title>`);
  });

  it('carries JSON-LD for the software and the site, with no price, rating or review', async () => {
    const { text } = await fetchText(origin, path);
    const raw = /<script type="application\/ld\+json">(.*?)<\/script>/s.exec(text)?.[1];
    expect(raw).toBeDefined();
    const data = JSON.parse(raw ?? '{}') as { '@context': string; '@graph': { '@type': string; url: string }[] };
    expect(data['@context']).toBe('https://schema.org');
    expect(data['@graph'].map((node) => node['@type'])).toEqual(['SoftwareApplication', 'WebSite']);
    expect(data['@graph'].every((node) => node.url === `${origin}${path}`)).toBe(true);
    expect(raw).not.toMatch(/offers|price|aggregateRating|review|ratingValue/i);
  });

  it('asks for nothing from a third party and has no inline script', async () => {
    const { text } = await fetchText(origin, path);
    expect(text).not.toMatch(/<link[^>]+rel="(stylesheet|preconnect|dns-prefetch)"/);
    // The one preload is the page's own font, from this origin (a path, never a URL with a host).
    const preloads = text.match(/<link[^>]+rel="preload"[^>]*>/g) ?? [];
    expect(preloads).toHaveLength(1);
    expect(preloads[0]).toMatch(/href="\/fonts\/[\w.-]+\.woff2" as="font" type="font\/woff2" crossorigin>/);
    expect(text).not.toMatch(/<(script|img|iframe|source)\b[^>]*\s(src|srcset)="(https?:)?\/\//);
    expect(text).not.toMatch(/fonts\.(googleapis|gstatic)|googletagmanager|analytics/i);
    for (const script of text.match(/<script\b[^>]*>/g) ?? []) {
      expect(script).toMatch(/type="application\/ld\+json"|src="\/standalone\.js"/);
    }
  });

  it('links the sign-in buttons to /app with the page language, and the deploy buttons to the deployment guide', async () => {
    const { text } = await fetchText(origin, path);
    expect(text).toContain(`href="/app?lang=${app}">${copy.cta.signIn}</a>`);
    // Four sign-in links: the quiet button in the header, the hero and the closing band (their priority is the owner's decision), and
    // the Product column of the footer.
    expect(count(text, /href="\/app[^"]*"/g)).toBe(4);
    expect(count(text, /href="\/app\?lang=[a-z]+"/g)).toBe(4);
    const header = /<header[\s\S]*?<\/header>/.exec(text)?.[0] ?? '';
    expect(header).toContain(`<a class="btn btn-sm" href="/app?lang=${app}">${copy.cta.signIn}</a>`);
    expect(count(text, /class="btn btn-primary" href="\/app/g)).toBe(1);
    const footer = /<footer[\s\S]*?<\/footer>/.exec(text)?.[0] ?? '';
    expect(footer).toContain(`<a href="/app?lang=${app}">${copy.cta.signIn}</a>`);
    expect(text).toContain('docs/deployment.md" rel="noopener">');
    // The guide is linked from the hero, under the deploy commands, from the closing band and from the footer.
    expect(count(text, /deployment\.md/g)).toBe(4);
  });

  it("holds no value of the maintainer's deployment (only the upstream links in links.ts are allowed)", async () => {
    const { text } = await fetchText(origin, path);
    // The words are written in pieces so that a repository-wide search for the maintainer's values (AC36) does not hit this test.
    const forbidden = [
      ['duongnam', 'truong'],
      ['hi', '@'],
      ['no', 'ah']
    ].map((pieces) => pieces.join(''));
    const withoutUpstreamLinks = text.replaceAll(GITHUB_URL, '');
    for (const word of forbidden) {
      expect(withoutUpstreamLinks.toLowerCase()).not.toContain(word);
    }
  });

  it('sends the security headers of a page the Worker builds itself', async () => {
    const { response } = await fetchText(origin, path);
    const csp = response.headers.get('Content-Security-Policy') ?? '';
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toMatch(/fonts\.|https:/);
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(response.headers.get('Referrer-Policy')).toBe('no-referrer');
    expect(response.headers.get('Strict-Transport-Security')).toMatch(/^max-age=\d+/);
    const local = await fetchText('http://localhost:8787', path);
    expect(local.response.headers.get('Strict-Transport-Security')).toBeNull();
  });
});
