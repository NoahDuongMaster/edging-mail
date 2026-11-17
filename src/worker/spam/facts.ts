// What the spam filter looks at: a small, plain description of one arriving mail, built from the parsed message. The rules are functions of this and of nothing
// else, so each one can be tested by writing the few fields it reads. Everything is cut to a fixed size here, so no rule can be made expensive by a large mail.

import type { Email } from 'postal-mime';
import type { AuthResult } from './auth-results';

/** The most characters of the text part and of the HTML part that are looked at. */
export const MAX_BODY_CHARS = 200_000;
const MAX_ATTACHMENT_NAMES = 100;
const MAX_NAME_CHARS = 255;

export interface MailFacts {
  /** The From address as stored on the row (the header's address, else the envelope sender), lower-case. */
  fromAddress: string;
  /** The display name of the From header, '' when there is none. */
  fromName: string;
  /** The first Reply-To address, lower-case, '' when there is none. */
  replyTo: string;
  /** The Subject header as written, '' when there is none. */
  subject: string;
  /** The text part and the HTML part, each cut to MAX_BODY_CHARS. */
  text: string;
  html: string;
  hasMessageId: boolean;
  hasDate: boolean;
  /** The file names of the attachments (at most 100, each at most 255 characters). */
  attachmentNames: readonly string[];
  /** Cloudflare's SPF/DKIM/DMARC result, null when the mail carried none of ours. */
  auth: AuthResult | null;
  /** The From address is on a domain this deployment hosts. Not in the message: the filter looks it up. */
  fromHosted: boolean;
}

const lower = (value: string | undefined): string => (value ?? '').trim().toLowerCase();

/** The facts of a parsed message. `fromAddress` is the one the row will store; `auth` is Cloudflare's result (null when there is none). */
export function factsFromEmail(parsed: Email, fromAddress: string, auth: AuthResult | null): MailFacts {
  const present = (name: string): boolean => parsed.headers.some((header) => header.key === name && header.value.trim() !== '');
  return {
    fromAddress: lower(fromAddress),
    fromName: (parsed.from?.name ?? '').slice(0, 300),
    replyTo: lower(parsed.replyTo?.[0]?.address),
    subject: (parsed.subject ?? '').slice(0, 2000),
    text: (parsed.text ?? '').slice(0, MAX_BODY_CHARS),
    html: (parsed.html ?? '').slice(0, MAX_BODY_CHARS),
    hasMessageId: present('message-id'),
    hasDate: present('date'),
    attachmentNames: parsed.attachments
      .slice(0, MAX_ATTACHMENT_NAMES)
      .map((attachment) => (attachment.filename ?? '').slice(0, MAX_NAME_CHARS)),
    auth,
    fromHosted: false
  };
}
