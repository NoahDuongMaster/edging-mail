// Which addresses of a mail name another host (PX-3), read the way a browser reads them. Pure string functions: the document builder
// (mailDocument.ts) uses them to take every remote address out of a mail until the reader chose 'Show images', and test/client/mail-urls.test.ts runs them.
//
// The browser is asked, not a pattern: `URL` drops the tabs and line breaks a sender hides inside `ht\ttp://`, reads `http:\\host` as `http://host`,
// keeps a scheme-relative `//host`, and leaves `data:`, `cid:`, `mailto:` and plain relative paths without a host.

const NOWHERE = 'mail.invalid';
const NOWHERE_BASE = `https://${NOWHERE}/`;

/** The text of whichever alternative of a pattern matched (the address of a `url(...)` or of a quoted string). */
function firstGroup(groups: readonly (string | undefined)[]): string {
  return groups.find((group) => group !== undefined) ?? '';
}

/** True when `value`, read as an address inside a document, names a host: `http://x`, `//x`, `HTTP:\\x`, `ht<TAB>tp://x`, `ftp://x`, `ws://x`. */
export function namesAHost(value: string): boolean {
  try {
    const { host } = new URL(value, NOWHERE_BASE);
    return host !== '' && host !== NOWHERE;
  } catch {
    // Not an address a browser can read, so not one it can fetch.
    return false;
  }
}

/** True when any candidate of a `srcset` names a host. A candidate is an address and, after a space, a width or a density: `a.png 1x, //h/b.png 2x`. */
export function srcsetNamesAHost(value: string): boolean {
  return value.split(',').some((candidate) => {
    const [address = ''] = candidate.trim().split(/\s+/, 1);
    return namesAHost(address);
  });
}

// --- CSS ------------------------------------------------------------------------------------------------------------------------------------------
// Style sheets are rewritten by pattern, not parsed: an address that hides behind a CSS escape (`u\72l(`) is not seen here, and the policy of the frame
// stays the gate for it (it blocks every kind of CSS fetch, in every engine the probe has been run in).

const URL_TOKEN = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^"')]*?))\s*\)/gi;
const IMPORT_RULE = /@import\s+(?:url\(\s*(?:"[^"]*"|'[^']*'|[^)]*)\s*\)|"[^"]*"|'[^']*')[^;{}]*;?/gi;
const IMAGE_SET = /(?:-webkit-)?image-set\([^)]*\)/gi;
const QUOTED = /"([^"]*)"|'([^']*)'/g;
const EMPTY_URL = 'url("data:,")';
const EMPTY_STRING = '"data:,"';

/** True when a style sheet or a `style` attribute fetches a picture from another host: a `url(...)` or an `image-set` string that names one. */
export function cssNamesAHost(css: string): boolean {
  for (const match of css.matchAll(URL_TOKEN)) {
    if (namesAHost(firstGroup(match.slice(1)))) {
      return true;
    }
  }
  return css.match(IMAGE_SET)?.some((call) => [...call.matchAll(QUOTED)].some((text) => namesAHost(firstGroup(text.slice(1))))) === true;
}

/**
 * The same CSS with no address of another host: such a `url(...)` becomes `url("data:,")` (an empty picture: layout and colours stay), the strings of an
 * `image-set` the same way, and an `@import` rule is dropped.
 */
export function withoutRemoteCss(css: string): string {
  return css
    .replaceAll(URL_TOKEN, (token: string, double?: string, single?: string, bare?: string) =>
      namesAHost(double ?? single ?? bare ?? '') ? EMPTY_URL : token
    )
    .replaceAll(IMPORT_RULE, '')
    .replaceAll(IMAGE_SET, (call: string) =>
      call.replaceAll(QUOTED, (text: string, double?: string, single?: string) =>
        namesAHost(double ?? single ?? '') ? EMPTY_STRING : text
      )
    );
}
