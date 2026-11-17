// The rules of the spam filter that read the headers, the subject and the attachment names, and the ONE table of weights and limits that every rule (here and in
// content-rules.ts) takes its numbers from. Each rule is a small pure function of the facts of the mail (facts.ts) that says whether it applies; a rule counts at
// most once per mail. score.ts adds the weights up and decides.

import type { MailFacts } from './facts';
import { hostOfAddress, hostsClaimedByName, relatedHosts } from './hosts';

/** A mail is spam when its score reaches this. Raising it makes the filter more careful; every weight below is meant to be read against it. */
export const THRESHOLD = 5;

/** What each rule adds to the score of a mail (a negative weight takes away). One entry per rule id: this table is the whole policy of the filter. */
export const WEIGHTS = {
  // Authentication: what Cloudflare recorded (mail with no result of ours triggers none of the first three)
  auth_failed: 3, // DMARC failed: the sender's domain says this mail is not from it
  auth_missing_pass: 3, // Cloudflare recorded a result and none of SPF, DKIM, DMARC passed
  auth_passed: -2, // DMARC passed: the From domain vouches for the mail
  spoofs_own_domain: 5, // the From address is on a domain this deployment hosts and DMARC did not pass: somebody posing as one of us
  // Headers
  reply_to_differs: 1, // Reply-To names a host unrelated to the From host
  display_name_mismatch: 3, // the display name carries an address or domain that is not the From host ("PayPal.com" <x@other.example>)
  no_message_id: 1, // no Message-ID header
  no_date: 1, // no Date header
  no_subject: 1, // no subject
  // Content (content-rules.ts)
  link_text_mismatch: 3, // a link whose text names one site and whose target is another
  link_ip_address: 2, // a link to a bare IP address
  link_shortener: 1, // a link through a well-known shortener
  hidden_text: 2, // a lot of text a reader cannot see
  image_only: 2, // HTML with an image and almost no text
  many_links: 1, // links to more than MANY_LINKS_OVER different hosts
  shouting_subject: 1, // a subject in capitals
  spam_phrases: 2, // for each distinct classic spam phrase, at most SPAM_PHRASES_CAP for the rule
  phishing_phrases: 3, // account-threat wording together with a link
  // Attachments
  risky_attachment: 7, // a program or script by its file name: more than the threshold plus the DMARC bonus, because any domain can pass DMARC
  html_attachment: 2, // a web page as an attachment
  macro_attachment: 2 // an Office file that can carry macros
} as const;

export type RuleId = keyof typeof WEIGHTS;

/** The most the `spam_phrases` rule can add, however many phrases a mail holds. */
export const SPAM_PHRASES_CAP = 6;
/** `many_links` applies to more than this many different link hosts. */
export const MANY_LINKS_OVER = 15;
/** `image_only` applies to HTML with fewer printed characters than this. */
export const IMAGE_ONLY_UNDER = 20;
/** `hidden_text` needs at least this many printed characters in hidden elements (a short hidden preheader is common in honest newsletters). */
export const HIDDEN_TEXT_MIN = 150;
/** `shouting_subject`: at least this many cased letters, and more than this share of them upper case. */
export const SHOUT_MIN_LETTERS = 10;
export const SHOUT_SHARE = 0.8;

/**
 * The id a block entry gives: the mail is spam whatever its score. Not a scoring rule (it is not in WEIGHTS) but it is stored as the reason of such a mail, so
 * the client has a text for it.
 */
export const BLOCK_LISTED = 'block_listed';

/** Every id that can appear in a stored `spam_reasons`: the rules that add to a score, and `block_listed`. (`auth_passed` only takes away, so it is never a reason.) */
export const SPAM_RULE_IDS: readonly string[] = [...(Object.keys(WEIGHTS) as RuleId[]).filter((id) => WEIGHTS[id] > 0), BLOCK_LISTED];

/** One rule that applied, with what it added. */
export interface Hit {
  id: RuleId;
  weight: number;
}

export const hit = (id: RuleId, weight: number = WEIGHTS[id]): Hit => ({ id, weight });

// --- Authentication (the result is Cloudflare's own; see auth-results.ts)

export const authFailed = (facts: MailFacts): boolean => facts.auth?.dmarc === 'fail';

export const authMissingPass = (facts: MailFacts): boolean =>
  facts.auth !== null && facts.auth.spf !== 'pass' && facts.auth.dkim !== 'pass' && facts.auth.dmarc !== 'pass';

export const authPassed = (facts: MailFacts): boolean => facts.auth?.dmarc === 'pass';

export const spoofsOwnDomain = (facts: MailFacts): boolean => facts.fromHosted && facts.auth?.dmarc !== 'pass';

// --- Headers

export function replyToDiffers(facts: MailFacts): boolean {
  const from = hostOfAddress(facts.fromAddress);
  const replyTo = hostOfAddress(facts.replyTo);
  return from !== '' && replyTo !== '' && !relatedHosts(from, replyTo);
}

export function displayNameMismatch(facts: MailFacts): boolean {
  const from = hostOfAddress(facts.fromAddress);
  return from !== '' && hostsClaimedByName(facts.fromName).some((claimed) => !relatedHosts(claimed, from));
}

export const noMessageId = (facts: MailFacts): boolean => !facts.hasMessageId;
export const noDate = (facts: MailFacts): boolean => !facts.hasDate;
export const noSubject = (facts: MailFacts): boolean => facts.subject.trim() === '';

/** At least SHOUT_MIN_LETTERS cased letters, and more than SHOUT_SHARE of them upper case. Letters without a case (Chinese) do not count. */
export function shoutingSubject(subject: string): boolean {
  let cased = 0;
  let upper = 0;
  for (const char of subject.slice(0, 1000)) {
    const up = char.toUpperCase();
    if (up === char.toLowerCase()) {
      continue;
    }
    cased += 1;
    upper += char === up ? 1 : 0;
  }
  return cased >= SHOUT_MIN_LETTERS && upper / cased > SHOUT_SHARE;
}

// --- Attachments (by file name only: the files themselves are never opened)

const RISKY = new Set([
  'exe',
  'scr',
  'com',
  'bat',
  'cmd',
  'js',
  'jse',
  'vbs',
  'vbe',
  'wsf',
  'jar',
  'msi',
  'lnk',
  'iso',
  'img',
  'hta',
  'ps1',
  'dll'
]);
const WEB_PAGE = new Set(['html', 'htm', 'shtml']);
const MACRO = new Set(['docm', 'xlsm', 'pptm', 'xlam']);

/** The extension a file name will open with: format characters (a right-to-left override hides one), trailing blanks and dots dropped, lower-case. */
export function extensionOf(filename: string): string {
  const clean = filename
    .replaceAll(/\p{Cf}/gu, '')
    .trim()
    .toLowerCase();
  let end = clean.length;
  while (end > 0 && /[\s.]/.test(clean.charAt(end - 1))) {
    end -= 1;
  }
  const dot = clean.lastIndexOf('.', end - 1);
  return dot === -1 ? '' : clean.slice(dot + 1, end);
}

// A double extension (`invoice.pdf.exe`) ends in the program's extension, so the one test covers it.
export const riskyAttachment = (facts: MailFacts): boolean => facts.attachmentNames.some((name) => RISKY.has(extensionOf(name)));
export const htmlAttachment = (facts: MailFacts): boolean => facts.attachmentNames.some((name) => WEB_PAGE.has(extensionOf(name)));
export const macroAttachment = (facts: MailFacts): boolean => facts.attachmentNames.some((name) => MACRO.has(extensionOf(name)));

/** The rules of this file that apply to a mail, in the order of WEIGHTS. */
export function headerAndAttachmentHits(facts: MailFacts): Hit[] {
  const checks: [RuleId, boolean][] = [
    ['auth_failed', authFailed(facts)],
    ['auth_missing_pass', authMissingPass(facts)],
    ['auth_passed', authPassed(facts)],
    ['spoofs_own_domain', spoofsOwnDomain(facts)],
    ['reply_to_differs', replyToDiffers(facts)],
    ['display_name_mismatch', displayNameMismatch(facts)],
    ['no_message_id', noMessageId(facts)],
    ['no_date', noDate(facts)],
    ['no_subject', noSubject(facts)],
    ['shouting_subject', shoutingSubject(facts.subject)],
    ['risky_attachment', riskyAttachment(facts)],
    ['html_attachment', htmlAttachment(facts)],
    ['macro_attachment', macroAttachment(facts)]
  ];
  return checks.filter(([, applies]) => applies).map(([id]) => hit(id));
}
