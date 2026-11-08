import type { LandingCopy } from './copy.types';
import { esc, safeJson } from './html';
import { LANGUAGES, languageOf } from './languages';
import { BRAND_NAME, MIT_LICENSE_URL, OG_IMAGE_HEIGHT, OG_IMAGE_PATH, OG_IMAGE_WIDTH } from './links';

/** The same page in each language; "/" is also the default for visitors whose language is none of them. */
const ALTERNATES = [
  ...LANGUAGES.map((language) => ({ hreflang: language.lang, path: language.path })),
  { hreflang: 'x-default', path: '/' }
];

/** Every absolute URL on the site is built from the origin the request came in on, so a fork on any host is right. */
export function robotsTxt(origin: string, landingOn: boolean): string {
  if (!landingOn) {
    return 'User-agent: *\nDisallow: /\n';
  }
  return `User-agent: *\nAllow: /\nDisallow: /app\nDisallow: /api\n\nSitemap: ${origin}/sitemap.xml\n`;
}

export function sitemapXml(origin: string): string {
  const alternates = ALTERNATES.map(
    (alternate) => `<xhtml:link rel="alternate" hreflang="${alternate.hreflang}" href="${esc(origin + alternate.path)}"/>`
  ).join('');
  const urls = LANGUAGES.map((language) => `<url><loc>${esc(origin + language.path)}</loc>${alternates}</url>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls}\n</urlset>\n`;
}

// schema.org markup for the page: the software and the site, with no price, rating or review (there are none to claim).
function structuredData(copy: LandingCopy, origin: string): unknown {
  const pageUrl = origin + copy.path;
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'SoftwareApplication',
        '@id': `${pageUrl}#software`,
        name: BRAND_NAME,
        description: copy.meta.description,
        url: pageUrl,
        inLanguage: copy.lang,
        applicationCategory: 'CommunicationApplication',
        operatingSystem: 'Any',
        license: MIT_LICENSE_URL,
        image: origin + OG_IMAGE_PATH
      },
      { '@type': 'WebSite', '@id': `${pageUrl}#website`, name: BRAND_NAME, url: pageUrl, inLanguage: copy.lang }
    ]
  };
}

/** The <head> tags that tell search engines and link previews about the page: title, description, canonical, languages, cards. */
export function seoTags(copy: LandingCopy, origin: string): string {
  const pageUrl = origin + copy.path;
  const image = origin + OG_IMAGE_PATH;
  const own = languageOf(copy.lang);
  const otherLocales = LANGUAGES.filter((language) => language !== own).map((language) => language.locale);
  const alternates = ALTERNATES.map(
    (alternate) => `<link rel="alternate" hreflang="${alternate.hreflang}" href="${esc(origin + alternate.path)}">`
  );
  const meta = (attribute: 'name' | 'property', key: string, content: string | number): string =>
    `<meta ${attribute}="${key}" content="${esc(String(content))}">`;
  return [
    `<title>${esc(copy.meta.title)}</title>`,
    meta('name', 'description', copy.meta.description),
    `<link rel="canonical" href="${esc(pageUrl)}">`,
    ...alternates,
    meta('property', 'og:type', 'website'),
    meta('property', 'og:site_name', BRAND_NAME),
    meta('property', 'og:title', copy.og.title),
    meta('property', 'og:description', copy.og.description),
    meta('property', 'og:url', pageUrl),
    meta('property', 'og:image', image),
    meta('property', 'og:image:type', 'image/png'),
    meta('property', 'og:image:width', OG_IMAGE_WIDTH),
    meta('property', 'og:image:height', OG_IMAGE_HEIGHT),
    meta('property', 'og:image:alt', copy.og.imageAlt),
    meta('property', 'og:locale', own.locale),
    ...otherLocales.map((locale) => meta('property', 'og:locale:alternate', locale)),
    meta('name', 'twitter:card', 'summary_large_image'),
    meta('name', 'twitter:title', copy.og.title),
    meta('name', 'twitter:description', copy.og.description),
    meta('name', 'twitter:image', image),
    meta('name', 'twitter:image:alt', copy.og.imageAlt),
    `<script type="application/ld+json">${safeJson(structuredData(copy, origin))}</script>`
  ].join('\n    ');
}
