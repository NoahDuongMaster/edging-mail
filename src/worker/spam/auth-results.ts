// What Cloudflare Email Routing recorded about a mail that arrived by email. Email Routing PREPENDS an `Authentication-Results` header whose authserv-id is
// `mx.cloudflare.net` (SPF, DKIM and DMARC, RFC 8601). Any other `Authentication-Results` header was written by the sender or by a server in front of
// Cloudflare, so it counts for nothing: only the FIRST such header of the message is read, and only when it is Cloudflare's.
//
// The headers come from the parsed message (postal-mime `headers`: every header, in document order, duplicates kept), not from the `Headers` object of the
// email event: that object joins repeated headers into one comma-separated value, which loses the boundary between Cloudflare's header and a forged one after it.
//
// The value is untrusted text. It is cut to a fixed length and read in one linear pass (no backtracking, no recursion), so a hostile header costs a little and never throws.

/** The result of one mechanism, as stored. Anything Cloudflare could write that is not one of these reads as `none`. */
export const AUTH_VALUES = ['pass', 'fail', 'none', 'neutral', 'softfail', 'temperror', 'permerror', 'policy'] as const;
export type AuthValue = (typeof AUTH_VALUES)[number];

export interface AuthResult {
  spf: AuthValue;
  dkim: AuthValue;
  dmarc: AuthValue;
}

/** The authserv-id Email Routing writes. */
const OUR_SERVER = 'mx.cloudflare.net';
// Cloudflare's header is a few hundred characters; this leaves room for several DKIM signatures and cuts anything longer.
const MAX_VALUE_LENGTH = 16_384;
const MAX_SEGMENTS = 200;
// A comment may nest in RFC 8601; deeper than this the rest of the header is not read.
const MAX_COMMENT_DEPTH = 32;

const VALUES: ReadonlySet<string> = new Set(AUTH_VALUES);
const METHOD_AND_RESULT = /^([\da-z][\da-z-]*)\s*=\s*([a-z]+)/i;

/**
 * The text of the header cut at every `;` that is outside a comment `( … )` and outside a quoted string. Comments are dropped (a space stands in for each),
 * quoted strings are kept. An unterminated quote or comment runs to the end of the value.
 */
function segmentsOf(value: string): string[] {
  const segments: string[] = [];
  let current = '';
  let depth = 0;
  let quoted = false;
  for (let index = 0; index < value.length && segments.length < MAX_SEGMENTS && depth <= MAX_COMMENT_DEPTH; index += 1) {
    const char = value.charAt(index);
    if (quoted) {
      current += char;
      switch (char) {
        case '\\': {
          // The escaped character is part of the string, whatever it is.
          index += 1;
          current += value.charAt(index);
          break;
        }
        case '"': {
          quoted = false;
          break;
        }
        default:
      }
    } else if (depth > 0) {
      switch (char) {
        case '\\': {
          index += 1;
          break;
        }
        case '(': {
          depth += 1;
          break;
        }
        case ')': {
          depth -= 1;
          current += depth === 0 ? ' ' : '';
          break;
        }
        default:
      }
    } else {
      switch (char) {
        case '(': {
          depth = 1;
          break;
        }
        case '"': {
          quoted = true;
          current += char;
          break;
        }
        case ';': {
          segments.push(current);
          current = '';
          break;
        }
        default: {
          current += char;
        }
      }
    }
  }
  segments.push(current);
  return segments;
}

const isMethod = (name: string | undefined): name is keyof AuthResult => ['spf', 'dkim', 'dmarc'].includes(name ?? '');

const normalise = (raw: string): AuthValue => {
  const value = raw.toLowerCase();
  return VALUES.has(value) ? (value as AuthValue) : 'none';
};

/**
 * The SPF, DKIM and DMARC results of one `Authentication-Results` value, or null when the header is not Cloudflare's (another authserv-id, or none).
 * A mechanism that is not named is `none`. SPF and DKIM may be reported several times (the HELO and the MAIL FROM check; one result per signature): `pass` wins
 * there. DMARC is reported once, so a second DMARC result is suspect: `pass` stands only when every one says pass, else the first that does not.
 */
export function parseAuthenticationResults(value: string): AuthResult | null {
  const [head, ...rest] = segmentsOf(value.length > MAX_VALUE_LENGTH ? value.slice(0, MAX_VALUE_LENGTH) : value);
  // The authserv-id is the first word; an optional version number may follow it.
  const server = head.trim().split(/\s/, 1)[0]?.toLowerCase().replace(/\.$/, '');
  if (server !== OUR_SERVER) {
    return null;
  }
  const seen: Record<keyof AuthResult, AuthValue[]> = { spf: [], dkim: [], dmarc: [] };
  for (const segment of rest) {
    const match = METHOD_AND_RESULT.exec(segment.trim());
    const method = match?.[1]?.toLowerCase();
    if (match !== null && isMethod(method)) {
      seen[method].push(normalise(match[2]));
    }
  }
  const best = (results: AuthValue[]): AuthValue =>
    results.includes('pass') ? 'pass' : (results.find((result) => result !== 'none') ?? 'none');
  const dmarc = seen.dmarc.every((result) => result === 'pass')
    ? (seen.dmarc[0] ?? 'none')
    : (seen.dmarc.find((result) => result !== 'pass') ?? 'none');
  return { spf: best(seen.spf), dkim: best(seen.dkim), dmarc };
}

/** What postal-mime hands over for each header. */
export interface HeaderLine {
  key: string;
  value: string;
}

/** Cloudflare's result for a message, from its headers in document order: only the first `Authentication-Results` header is looked at. */
export function ourAuthResult(headers: readonly HeaderLine[]): AuthResult | null {
  try {
    const first = headers.find((header) => header.key === 'authentication-results');
    return first === undefined ? null : parseAuthenticationResults(first.value);
  } catch {
    // The parser does not throw; this is the last guard of the inbound path, where a throw would refuse a mail.
    return null;
  }
}

/** The `auth` column: `spf=<r>;dkim=<r>;dmarc=<r>`. */
export const formatAuth = (result: AuthResult): string => `spf=${result.spf};dkim=${result.dkim};dmarc=${result.dmarc}`;

const STORED = /^spf=([a-z]+);dkim=([a-z]+);dmarc=([a-z]+)$/;

/** The result a stored `auth` column holds, or null for NULL and for anything that is not exactly the stored form. */
export function readAuth(column: string | null | undefined): AuthResult | null {
  const match = typeof column === 'string' ? STORED.exec(column) : null;
  if (match === null || ![match[1], match[2], match[3]].every((value) => VALUES.has(value))) {
    return null;
  }
  return { spf: match[1] as AuthValue, dkim: match[2] as AuthValue, dmarc: match[3] as AuthValue };
}

/** Did Cloudflare record `dmarc=pass` for this stored `auth` column? NULL and every other result: no. */
export const dmarcPassed = (column: string | null | undefined): boolean => readAuth(column)?.dmarc === 'pass';
