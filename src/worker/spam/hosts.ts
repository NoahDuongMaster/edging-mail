// Host names found in a mail: link targets, the host of an address, the domain-like words of a display name. Pure string work on text that is hostile by
// default: every function is bounded by the length it is given and nothing here backtracks.

import { decodeEntities } from './html-text';

const MAX_URL_LENGTH = 2048;

// Link shorteners that hide where a link goes (t.co is left out on purpose: mail from X uses it for every link).
const SHORTENERS: ReadonlySet<string> = new Set([
  'bit.ly',
  'tinyurl.com',
  'goo.gl',
  'ow.ly',
  'is.gd',
  'cutt.ly',
  'rb.gy',
  't.ly',
  'shorturl.at',
  'rebrand.ly'
]);

// Second-level labels under a two-letter country code (co.uk, com.vn, ...): the registrable domain then has three labels.
const COUNTRY_SECOND_LEVELS: ReadonlySet<string> = new Set([
  'co',
  'com',
  'net',
  'org',
  'gov',
  'edu',
  'ac',
  'or',
  'ne',
  'go',
  'gob',
  'mil',
  'nom',
  'ltd',
  'sch'
]);

// The top-level domains a display name is read as a domain for ("Amazon.com"): the common ones, so that "Node.js" or "Vue.js" is a name and not a host.
const COMMON_TLDS: ReadonlySet<string> = new Set([
  'com',
  'net',
  'org',
  'edu',
  'gov',
  'info',
  'biz',
  'io',
  'co',
  'me',
  'us',
  'uk',
  'de',
  'fr',
  'ru',
  'cn',
  'jp',
  'vn',
  'kr',
  'in',
  'br',
  'au',
  'ca',
  'nl',
  'it',
  'es',
  'tv',
  'cc',
  'xyz',
  'top',
  'online',
  'site',
  'shop',
  'app'
]);

const HOST_SHAPE = /^[\da-z-]+(?:\.[\da-z-]+)+$/;
const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;

/** The host a link points at (lower-case, no port, no trailing dot), or null for a link that is not http(s) or does not parse (mailto:, tel:, #, a relative path). */
export function hostOfUrl(href: string): string | null {
  const cleaned = decodeEntities(href.slice(0, MAX_URL_LENGTH)).trim();
  const lower = cleaned.slice(0, 8).toLowerCase();
  const absolute = lower.startsWith('http://') || lower.startsWith('https://');
  if (!absolute && !cleaned.startsWith('//')) {
    return null;
  }
  try {
    const url = new URL(absolute ? cleaned : `https:${cleaned}`);
    return url.hostname.replace(/\.$/, '').toLowerCase() || null;
  } catch {
    return null;
  }
}

/** A host that is an address, not a name: dotted IPv4 (the URL parser also turns decimal and hex forms into it) or an IPv6 literal. */
export const isIpHost = (host: string): boolean => host.startsWith('[') || IPV4.test(host);

/** The domain a host belongs to, near enough for comparing two hosts: the last two labels, three under a country code with a second level (co.uk). */
export function registrableDomain(host: string): string {
  const labels = host.split('.');
  if (labels.length <= 2) {
    return host;
  }
  const last = labels.at(-1) ?? '';
  const second = labels.at(-2) ?? '';
  return labels.slice(last.length === 2 && COUNTRY_SECOND_LEVELS.has(second) ? -3 : -2).join('.');
}

export const isShortener = (host: string): boolean => SHORTENERS.has(registrableDomain(host));

/** The same host, a subdomain of the other, or two hosts of one registrable domain (news.brand.com and support.brand.com). */
export function relatedHosts(a: string, b: string): boolean {
  return (
    a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`) || (!isIpHost(a) && !isIpHost(b) && registrableDomain(a) === registrableDomain(b))
  );
}

/**
 * The host a text names when the whole text is a URL or a web address ("https://paypal.com/login", "www.paypal.com", "paypal.com/login"), else null. A bare
 * domain with nothing else ("Walmart.com", "Dilbert.com") is not read as an address: honest mail writes a brand that way over a link to its own tracking host,
 * so it says nothing about where the link should go.
 */
export function hostNamedBy(text: string): string | null {
  let rest = text.trim().toLowerCase();
  if (rest.length === 0 || rest.length > 300 || /\s/.test(rest)) {
    return null;
  }
  let strong = false;
  for (const scheme of ['https://', 'http://']) {
    if (rest.startsWith(scheme)) {
      rest = rest.slice(scheme.length);
      strong = true;
    }
  }
  const end = rest.search(/[/?#:]/);
  const host = (end === -1 ? rest : rest.slice(0, end)).replace(/\.$/, '');
  const tld = host.slice(host.lastIndexOf('.') + 1);
  if (!HOST_SHAPE.test(host) || !/^[a-z]{2,24}$/.test(tld)) {
    return null;
  }
  return strong || host.startsWith('www.') || (end !== -1 && rest.charAt(end) === '/') ? host : null;
}

const ADDRESS_IN_NAME = /[^\s<>"',;()[\]]{1,64}@([^\s<>"',;()[\]@]{1,255})/;
const NAME_QUOTES: ReadonlySet<string> = new Set(['"', "'", '<', '>', ' ', '\t']);

/**
 * The hosts a display name claims: the host of an address written in it ("billing@paypal.com"), and the host of a name that is nothing but a web address
 * ("PayPal.com", "www.paypal.com"). A domain inside a longer name ("CNET News.com Daily Dispatch") is a brand, not a claim. Looks at the first 200 characters.
 */
export function hostsClaimedByName(name: string): string[] {
  const text = name.slice(0, 200).toLowerCase();
  const hosts: string[] = [];
  const address = ADDRESS_IN_NAME.exec(text);
  const addressHost = address?.[1]?.replace(/[.,]+$/, '') ?? '';
  if (HOST_SHAPE.test(addressHost)) {
    hosts.push(addressHost);
  }
  let start = 0;
  let end = text.length;
  while (start < end && NAME_QUOTES.has(text.charAt(start))) {
    start += 1;
  }
  while (end > start && NAME_QUOTES.has(text.charAt(end - 1))) {
    end -= 1;
  }
  const whole = text.slice(start, end).replace(/^https?:\/\//, '');
  const host = whole.split('/', 1)[0] ?? '';
  if (!/\s|@/.test(host) && HOST_SHAPE.test(host) && COMMON_TLDS.has(host.slice(host.lastIndexOf('.') + 1))) {
    hosts.push(host);
  }
  return hosts;
}

/** The host of an address (after the last `@`), lower-case; '' when there is none. */
export const hostOfAddress = (address: string): string => {
  const at = address.lastIndexOf('@');
  return at === -1
    ? ''
    : address
        .slice(at + 1)
        .trim()
        .toLowerCase()
        .replace(/\.$/, '');
};
