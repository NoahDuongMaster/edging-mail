// The rules of the spam filter that read what the mail says: its links, its hidden text, its images, its subject and body wording. `analyse` reads the mail ONCE
// (a bounded scan of the HTML, the links of the text part, the folded wording) and the rules are small functions of that reading. Weights and limits are in rules.ts.

import type { MailFacts } from './facts';
import { hostNamedBy, hostOfUrl, isIpHost, isShortener, relatedHosts } from './hosts';
import { scanHtml } from './html-scan';
import type { HtmlScan } from './html-scan';
import { fold, matchedPhrases, PHISHING_PHRASES, SPAM_PHRASES } from './phrases';
import { hit, HIDDEN_TEXT_MIN, IMAGE_ONLY_UNDER, MANY_LINKS_OVER, SPAM_PHRASES_CAP, WEIGHTS } from './rules';
import type { Hit, RuleId } from './rules';

// The wording is looked for in the subject and in the first part of the body.
const PHRASE_SCAN_CHARS = 20_000;
// A bound on the links read from the text part, and on the distinct hosts kept.
const MAX_TEXT_LINKS = 500;
const MAX_HOSTS = 200;

/** The text of a plain-text mail rarely has anchors: its links are the addresses written out. */
const URL_IN_TEXT = /https?:\/\/[^\s<>"']{1,2048}/gi;
// What a sentence puts after an address ("(see https://example.com).") is not part of it, unless the host is an IPv6 literal.
const TRAILING_PUNCTUATION = /[).,;:!?\]]/;

function trimTrailing(url: string): string {
  let end = url.length;
  while (end > 0 && !url.includes('[') && TRAILING_PUNCTUATION.test(url.charAt(end - 1))) {
    end -= 1;
  }
  return url.slice(0, end);
}

/** What one reading of the mail found. */
export interface Content {
  scan: HtmlScan;
  /** The different hosts the mail links to (anchors of the HTML and addresses written in the text), at most 200. */
  hosts: ReadonlySet<string>;
  /** An anchor whose text names a site other than the one its link goes to. */
  textMismatch: boolean;
  /** Spam phrases found in the subject and the start of the body (folded), each once. */
  spamPhrases: readonly string[];
  /** Account-threat phrases found there, each once. */
  phishingPhrases: readonly string[];
}

/** Reads the mail's links, HTML and wording. Bounded: the HTML scan reads at most 200000 characters, the wording scan 20000 of each part. */
export function analyse(facts: MailFacts): Content {
  const scan = scanHtml(facts.html);
  const hosts = new Set<string>();
  let textMismatch = false;
  for (const anchor of scan.anchors) {
    const host = hostOfUrl(anchor.href);
    if (host === null) {
      continue;
    }
    if (hosts.size < MAX_HOSTS) {
      hosts.add(host);
    }
    const named = hostNamedBy(anchor.text);
    textMismatch ||= named !== null && !relatedHosts(named, host);
  }
  let links = 0;
  for (const found of facts.text.matchAll(URL_IN_TEXT)) {
    links += 1;
    const host = hostOfUrl(trimTrailing(found[0]));
    if (host !== null && hosts.size < MAX_HOSTS) {
      hosts.add(host);
    }
    if (links >= MAX_TEXT_LINKS) {
      break;
    }
  }
  const haystack = fold(`${facts.subject}\n${facts.text.slice(0, PHRASE_SCAN_CHARS)}\n${scan.visibleText.slice(0, PHRASE_SCAN_CHARS)}`);
  return {
    scan,
    hosts,
    textMismatch,
    spamPhrases: matchedPhrases(haystack, SPAM_PHRASES),
    phishingPhrases: matchedPhrases(haystack, PHISHING_PHRASES)
  };
}

export const linkTextMismatch = (content: Content): boolean => content.textMismatch;
export const linkIpAddress = (content: Content): boolean => [...content.hosts].some((host) => isIpHost(host));
export const linkShortener = (content: Content): boolean => [...content.hosts].some((host) => isShortener(host));
export const hiddenText = (content: Content): boolean => content.scan.hiddenLength >= HIDDEN_TEXT_MIN;
export const imageOnly = (content: Content): boolean => content.scan.imageCount > 0 && content.scan.visibleLength < IMAGE_ONLY_UNDER;
export const manyLinks = (content: Content): boolean => content.hosts.size > MANY_LINKS_OVER;
/** Account-threat wording counts only next to a link: the mail asks for something to be clicked. */
export const phishingPhrases = (content: Content): boolean => content.phishingPhrases.length > 0 && content.hosts.size > 0;

/** What `spam_phrases` adds: the weight of a phrase for each distinct one found, at most SPAM_PHRASES_CAP. 0 when there is none. */
export const spamPhrasesWeight = (content: Content): number =>
  Math.min(content.spamPhrases.length * WEIGHTS.spam_phrases, SPAM_PHRASES_CAP);

/** The content rules that apply to a reading of the mail. */
export function contentHits(content: Content): Hit[] {
  const checks: [RuleId, boolean][] = [
    ['link_text_mismatch', linkTextMismatch(content)],
    ['link_ip_address', linkIpAddress(content)],
    ['link_shortener', linkShortener(content)],
    ['hidden_text', hiddenText(content)],
    ['image_only', imageOnly(content)],
    ['many_links', manyLinks(content)],
    ['phishing_phrases', phishingPhrases(content)]
  ];
  const hits = checks.filter(([, applies]) => applies).map(([id]) => hit(id));
  const phrases = spamPhrasesWeight(content);
  return phrases > 0 ? [...hits, hit('spam_phrases', phrases)] : hits;
}
