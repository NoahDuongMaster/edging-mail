import { isHostname } from './addresses';
import type { SenderPictureMime } from './db/schema';
import { concat, utf8 } from '../shared/crypto/server';

// Asking Gravatar and Libravatar for the picture of ONE address (the provider side of pictures.ts, which decides when to ask and keeps the answers).
//
// What leaves the Worker is the SHA-256 of the lower-cased, trimmed address inside a GET URL, and nothing else: no cookie, no Referer, no
// Accept-Language, and the plain User-Agent `edging-mail`. The address itself is never sent from here, and nothing here stores or logs it. There is no
// Libravatar federation (a DNS SRV lookup on the sender's own domain would let the sender choose a host this Worker calls whenever its mail is
// shown) and no BIMI. The providers are the fixed list below, and a redirect is followed only to one of their own hosts.

/** The most bytes of a picture that is kept. A reply with more is refused without being read to its end. */
export const MAX_SENDER_PICTURE_BYTES = 24_000;

const LOOKUP_TIMEOUT_MS = 5000;
const MAX_REDIRECTS = 2;

/** In this order. 128 pixels is the largest the app shows (3x of a 40 px tile); `d=404` makes a provider answer 404 instead of a default image. */
const PROVIDERS: readonly ((hash: string) => string)[] = [
  (hash) => `https://gravatar.com/avatar/${hash}?s=128&d=404&r=pg`,
  (hash) => `https://seccdn.libravatar.org/avatar/${hash}?s=128&d=404`
];

// A redirect is followed only to one of the providers' own hosts, over https on the default port. Gravatar answers a picture directly; Libravatar's
// central server redirects to a path on its own host (it proxies Gravatar for a hash it does not hold itself).
const isProviderHost = (host: string): boolean =>
  host === 'gravatar.com' || host.endsWith('.gravatar.com') || host === 'seccdn.libravatar.org' || host === 'cdn.libravatar.org';
// `href` starting with the origin also refuses a URL that carries credentials (`https://name@host/`), which the origin leaves out.
const mayFollow = (url: URL): boolean =>
  url.protocol === 'https:' && url.port === '' && isProviderHost(url.hostname) && url.href.startsWith(`${url.origin}/`);

const startsWith = (bytes: Uint8Array, offset: number, expected: readonly number[]): boolean =>
  expected.every((byte, index) => bytes[offset + index] === byte);

/** The declared type must be what the bytes are: JPEG starts FF D8 FF; PNG starts 89 'PNG' 0D 0A 1A 0A; WebP is 'RIFF', four size bytes, 'WEBP'. */
export function matchesMime(mime: string, bytes: Uint8Array): boolean {
  if (mime === 'image/jpeg') {
    return startsWith(bytes, 0, [0xff, 0xd8, 0xff]);
  }
  if (mime === 'image/png') {
    return startsWith(bytes, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  }
  return startsWith(bytes, 0, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, 8, [0x57, 0x45, 0x42, 0x50]);
}

const SENDER_MIMES: ReadonlySet<string> = new Set<SenderPictureMime>(['image/jpeg', 'image/webp', 'image/png']);
const isSenderMime = (value: string): value is SenderPictureMime => SENDER_MIMES.has(value);

const LOCAL_PART = /^[\w!#$%&'*+/=?^`{|}~-]+(?:\.[\w!#$%&'*+/=?^`{|}~-]+)*$/;
const MAX_LOCAL_PART = 64;

/**
 * The address a lookup may be made for: trimmed, lower-cased, and a plain `local@domain` (ASCII, one `@`, a dotted host name). Anything else (a
 * display name, angle brackets, quotes, a comma, an IP literal, a name with no dot) gives null: nothing is sent for it.
 */
export function lookableAddress(address: string): string | null {
  const normal = address.trim().toLowerCase();
  const at = normal.indexOf('@');
  if (at < 1 || at !== normal.lastIndexOf('@')) {
    return null;
  }
  const local = normal.slice(0, at);
  return local.length <= MAX_LOCAL_PART && LOCAL_PART.test(local) && isHostname(normal.slice(at + 1)) ? normal : null;
}

/** The SHA-256 of an address, as 64 lower-case hex digits: the name Gravatar and Libravatar know a person by, and the key of the stored row. */
export async function addressHash(address: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', utf8(address)));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** What looking one address up came to: a picture, none anywhere, or a failure that may pass (so the sender is asked again soon). */
export type Lookup = { kind: 'found'; mime: SenderPictureMime; bytes: Uint8Array<ArrayBuffer> } | { kind: 'none' } | { kind: 'failed' };

const NONE: Lookup = { kind: 'none' };
const FAILED: Lookup = { kind: 'failed' };

const discard = async (response: Response): Promise<void> => {
  await response.body?.cancel().catch(() => null);
};

/** The body, or null as soon as it is longer than `cap` (the rest is not read: the reader is cancelled). */
async function readCapped(response: Response, cap: number): Promise<Uint8Array<ArrayBuffer> | null> {
  const reader = response.body?.getReader();
  if (reader === undefined) {
    return new Uint8Array(0);
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      return concat(...chunks);
    }
    total += value.length;
    if (total > cap) {
      await reader.cancel().catch(() => null);
      return null;
    }
    chunks.push(value);
  }
}

/**
 * One provider. 200 with an image of an accepted type, matching bytes and at most 24000 of them is a picture. 404 and 410 (and anything this code does
 * not understand: another status, a wrong type or magic, too many bytes, a redirect that is not allowed) are 'none here'. A network error, a timeout, 429 or
 * 5xx is a failure that may pass. Redirects are handled here, not by `fetch`: at most two, each only to an allowed host.
 */
async function askProvider(start: string): Promise<Lookup> {
  let url = new URL(start);
  for (let redirects = 0; ; redirects += 1) {
    let response: Response;
    try {
      // No cookies, no Referer, no Accept-Language: only the User-Agent below. `manual`: a redirect comes back to be checked, never followed by `fetch`.
      response = await fetch(url.href, {
        redirect: 'manual',
        headers: { 'User-Agent': 'edging-mail' },
        signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS)
      });
    } catch {
      return FAILED;
    }
    const { status } = response;
    if ([301, 302, 303, 307, 308].includes(status)) {
      await discard(response);
      const location = response.headers.get('Location');
      let next: URL | null = null;
      try {
        next = location === null ? null : new URL(location, url);
      } catch {
        next = null;
      }
      if (next === null || redirects >= MAX_REDIRECTS || !mayFollow(next)) {
        return NONE;
      }
      url = next;
      continue;
    }
    if (status === 429 || status >= 500) {
      await discard(response);
      return FAILED;
    }
    // Libravatar's proxy names a JPEG `image/jpg`; the magic bytes below still decide what the picture is.
    const named = (response.headers.get('Content-Type') ?? '').split(';', 1)[0]?.trim().toLowerCase() ?? '';
    const mime = named === 'image/jpg' ? 'image/jpeg' : named;
    const declared = Number(response.headers.get('Content-Length'));
    if (status !== 200 || !isSenderMime(mime) || declared > MAX_SENDER_PICTURE_BYTES) {
      await discard(response);
      return NONE;
    }
    let bytes: Uint8Array<ArrayBuffer> | null;
    try {
      bytes = await readCapped(response, MAX_SENDER_PICTURE_BYTES);
    } catch {
      return FAILED;
    }
    return bytes !== null && bytes.length > 0 && matchesMime(mime, bytes) ? { kind: 'found', mime, bytes } : NONE;
  }
}

/** The providers in order for one hash: the first picture wins; 'none' only when every provider said so; one failure that may pass makes the whole answer a failure. */
export async function lookUpPicture(hash: string): Promise<Lookup> {
  let failed = false;
  for (const urlOf of PROVIDERS) {
    const answer = await askProvider(urlOf(hash));
    if (answer.kind === 'found') {
      return answer;
    }
    failed ||= answer.kind === 'failed';
  }
  return failed ? FAILED : NONE;
}
