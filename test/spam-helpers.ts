import type { MailFacts } from '../src/worker/spam/facts';

// Shared by the spam-filter tests: the facts of a plain, harmless mail (which scores 0), and a builder of raw messages.

/** A harmless mail: nothing in it triggers a rule. Pass the fields a test is about. */
export function facts(overrides: Partial<MailFacts> = {}): MailFacts {
  return {
    fromAddress: 'alice@example.org',
    fromName: 'Alice',
    replyTo: '',
    subject: 'Lunch on Friday',
    text: 'Shall we have lunch on Friday? I know a good place near the station.',
    html: '',
    hasMessageId: true,
    hasDate: true,
    attachmentNames: [],
    auth: null,
    fromHosted: false,
    ...overrides
  };
}

export const CLOUDFLARE_PASS =
  'Authentication-Results: mx.cloudflare.net; dkim=pass header.d=example.org; dmarc=pass header.from=example.org; spf=pass smtp.mailfrom=alice@example.org';
export const CLOUDFLARE_FAIL =
  'Authentication-Results: mx.cloudflare.net; dkim=none; dmarc=fail header.from=example.org; spf=fail smtp.mailfrom=alice@example.org';
export const CLOUDFLARE_NONE = 'Authentication-Results: mx.cloudflare.net; dkim=none; dmarc=none; spf=none';

export interface MimeOptions {
  from?: string;
  to?: string;
  subject?: string;
  /** Extra header lines, written first (an Authentication-Results line goes here). */
  headers?: string[];
  /** Set to false to leave the header out. */
  messageId?: string | false;
  date?: string | false;
  text?: string;
  html?: string;
  attachments?: { name: string; type?: string; content?: string }[];
}

/** A raw message: single part, multipart/alternative or multipart/mixed according to what is given. */
export function mime(options: MimeOptions = {}): string {
  const head = [
    ...(options.headers ?? []),
    `From: ${options.from ?? 'Alice <alice@example.org>'}`,
    `To: ${options.to ?? 'bob@example.com'}`,
    ...(options.subject === undefined ? ['Subject: Lunch on Friday'] : options.subject === '' ? [] : [`Subject: ${options.subject}`]),
    ...(options.messageId === false ? [] : [`Message-ID: ${options.messageId ?? `<${crypto.randomUUID()}@example.org>`}`]),
    ...(options.date === false ? [] : [`Date: ${options.date ?? 'Tue, 17 Nov 2026 09:30:00 +0700'}`]),
    'MIME-Version: 1.0'
  ];
  const text = options.text ?? (options.html === undefined ? 'Shall we have lunch on Friday?' : undefined);
  const parts: string[][] = [];
  if (text !== undefined && options.html !== undefined) {
    parts.push([
      'Content-Type: multipart/alternative; boundary="alt"',
      '',
      '--alt',
      'Content-Type: text/plain; charset=utf-8',
      '',
      text,
      '--alt',
      'Content-Type: text/html; charset=utf-8',
      '',
      options.html,
      '--alt--'
    ]);
  } else if (options.html === undefined) {
    parts.push(['Content-Type: text/plain; charset=utf-8', '', text ?? '']);
  } else {
    parts.push(['Content-Type: text/html; charset=utf-8', '', options.html]);
  }
  const body = parts[0] ?? [];
  if (options.attachments === undefined || options.attachments.length === 0) {
    return [...head, ...body, ''].join('\r\n');
  }
  const attached = options.attachments.flatMap((file) => [
    '--mix',
    `Content-Type: ${file.type ?? 'application/octet-stream'}; name="${file.name}"`,
    `Content-Disposition: attachment; filename="${file.name}"`,
    'Content-Transfer-Encoding: base64',
    '',
    btoa(file.content ?? 'content')
  ]);
  return [...head, 'Content-Type: multipart/mixed; boundary="mix"', '', '--mix', ...body, ...attached, '--mix--', ''].join('\r\n');
}
