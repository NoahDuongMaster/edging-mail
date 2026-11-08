import { normalizeCid } from './mailcrypto/inline';
import { settle } from './mailSettle';
import { cssNamesAHost, namesAHost, srcsetNamesAHost, withoutRemoteCss } from './mailUrls';

// Mail is untrusted: nothing may load except inline styles and data: images/fonts, and the frame cannot navigate.
// The page's own policy (public/_headers) is inherited by a srcdoc frame and is wider (`img-src https:`) because
// 'Show images' must be able to widen the frame's policy; the meta policy built here is the gate for remote content.
export const framePolicy = (images: string): string =>
  `default-src 'none'; img-src ${images}; style-src 'unsafe-inline'; font-src data:; frame-src 'none'`;

const EMBEDDED_URL = /^\s*cid:/i;

// Words a person reads: an address written there is text, not something to fetch.
const READ_AS_TEXT = new Set(['alt', 'title', 'placeholder', 'value', 'label', 'summary', 'aria-label']);

function anyAttribute(doc: Document, selector: string, attribute: string, test: (value: string) => boolean): boolean {
  return [...doc.querySelectorAll(selector)].some((element) => test(element.getAttribute(attribute) ?? ''));
}

/**
 * PX-3, second line: until the reader chose 'Show images' the document itself names no address of another host, whatever the meta policy says. Firefox
 * does not apply that policy to `srcset` and `<picture>` (truong's repro: the image was fetched when the mail was opened), so no class of request relies
 * on the policy alone. Every attribute whose value is such an address goes (`src`, `poster`, `background`, `data`, `action`, `href` of an SVG picture,
 * `data-*`, ...), except the target of a link, which is only followed by a click, and the words a person reads. `srcset` and `sizes` go whatever they
 * hold. The remote addresses of every style sheet and `style` attribute become an empty picture.
 */
function dropRemoteAddresses(doc: Document): void {
  for (const element of doc.querySelectorAll('*')) {
    const followed = element.matches('a, area');
    // The names are a list taken first: removing an attribute while walking the live list of them would skip the next one.
    for (const attribute of element.getAttributeNames()) {
      const name = attribute.toLowerCase();
      const value = element.getAttribute(attribute) ?? '';
      if (name === 'srcset' || name === 'sizes') {
        element.removeAttribute(attribute);
      } else if (name === 'style') {
        const quiet = withoutRemoteCss(value);
        if (quiet !== value) {
          element.setAttribute(attribute, quiet);
        }
      } else if (!READ_AS_TEXT.has(name) && !(followed && name === 'href') && namesAHost(value)) {
        element.removeAttribute(attribute);
      }
    }
  }
  for (const style of doc.querySelectorAll('style')) {
    style.textContent = withoutRemoteCss(style.textContent);
  }
}

export interface MailDocument {
  srcDoc: string;
  hasRemoteImages: boolean;
  /** The `cid:` references of the pictures the mail carries inside itself, as written. */
  embedded: string[];
}

function serialise(doc: Document): string {
  return `<!DOCTYPE html>${doc.documentElement.outerHTML}`;
}

/**
 * Everything that makes the document safe (PX-3, PX-14), written so that it can run again on a document that was read back from its own text (PX-15): it
 * removes the head elements it adds first, so that a second run adds them once.
 */
function neutralise(doc: Document, allowImages: boolean): void {
  for (const link of doc.querySelectorAll('a[href], area[href]')) {
    link.setAttribute('target', '_blank');
    link.setAttribute('rel', 'noopener noreferrer');
  }
  // Our own head elements go first, so that running this again adds them once; a sender's own policy or referrer setting goes with them, so that only
  // ours is left.
  for (const own of doc.querySelectorAll('meta[http-equiv="content-security-policy" i], meta[name="referrer" i]')) {
    own.remove();
  }
  // A refresh would navigate the frame to a page of the sender's choosing; a sender's DNS prefetch switch would undo ours below.
  for (const meta of doc.querySelectorAll('meta[http-equiv="refresh" i], meta[http-equiv="x-dns-prefetch-control" i]')) {
    meta.remove();
  }
  // PX-3: every <link> and <base>, wherever the sender put them, and every ping attribute.
  for (const element of doc.querySelectorAll('link, base')) {
    element.remove();
  }
  for (const element of doc.querySelectorAll('[ping]')) {
    element.removeAttribute('ping');
  }
  // Speculation rules name addresses to prefetch or prerender, in a script's text where no attribute check sees them.
  for (const element of doc.querySelectorAll('script[type="speculationrules" i]')) {
    element.remove();
  }
  // Until the reader chose 'Show images' (the document is built again, from the original markup, when they do) it names no remote address.
  if (!allowImages) {
    dropRemoteAddresses(doc);
  }

  // Not head.prepend(): @cloudflare/workers-types overrides Element.prepend with the HTMLRewriter signature.
  // The one <base> of the document is ours: a default target for any link the loop above did not reach, and no address.
  const base = doc.createElement('base');
  base.target = '_blank';
  doc.head.insertBefore(base, doc.head.firstChild);
  const referrer = doc.createElement('meta');
  referrer.name = 'referrer';
  referrer.content = 'no-referrer';
  doc.head.insertBefore(referrer, doc.head.firstChild);
  // The policy covers everything after it, so it comes before everything the document has; DNS prefetch off is the very first of all.
  const policy = doc.createElement('meta');
  policy.httpEquiv = 'Content-Security-Policy';
  policy.content = framePolicy(allowImages ? 'data: https:' : 'data:');
  doc.head.insertBefore(policy, doc.head.firstChild);
  const dns = doc.createElement('meta');
  dns.httpEquiv = 'x-dns-prefetch-control';
  dns.content = 'off';
  doc.head.insertBefore(dns, doc.head.firstChild);
}

/**
 * The document the sandboxed frame shows for a mail's HTML. Nothing in it may reach the network until the reader pressed 'Show images', and then
 * only pictures: the meta policy does that for everything it covers, and what it cannot cover is taken out before the document is written
 * (PX-3): a `<link>` (a `rel=prerender` is fetched whatever the policy says; `prefetch`, `preconnect`, `dns-prefetch`, `stylesheet`, `icon` and
 * the rest have no use in a static document), a `<base>` of the sender's (it would re-aim every relative address), a `ping` attribute (a click
 * would report to the sender), speculation rules, and a sender's own DNS prefetch setting. DNS prefetch is switched off for the whole document.
 * While images are not allowed the document carries no remote address at all (`dropRemoteAddresses`). All of this is done again on the document read back from
 * its own text until the text stops changing (PX-15), because the frame parses the text and not the tree that was checked.
 */
export function buildMailDocument(html: string, accent: string, allowImages: boolean, opened: ReadonlyMap<string, string>): MailDocument {
  // Parsed inertly (no script runs, nothing loads) so links can be fixed up before the sandboxed frame sees them.
  // The sender's markup lands in the body exactly as it did before, so its own <style> blocks keep working.
  const doc = new DOMParser().parseFromString(
    `<!DOCTYPE html><html><head><meta charset="utf-8" /><style>
        html,body{margin:0;padding:0;background:#ffffff;}
        body{font-family:'Geist',ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;font-size:15px;line-height:24px;color:#1f2430;word-break:break-word;padding:24px;}
        img{max-width:100%;height:auto;} a{color:${accent};}
        blockquote{margin:0 0 0 12px;padding-left:12px;border-left:2px solid #e3e6eb;color:#535a66;}
        table{max-width:100%;}
      </style></head><body>${html}</body></html>`,
    'text/html'
  );

  const hasRemoteImages =
    anyAttribute(doc, 'img[src]', 'src', namesAHost) ||
    anyAttribute(doc, '[srcset]', 'srcset', srcsetNamesAHost) ||
    anyAttribute(doc, '[background]', 'background', namesAHost) ||
    anyAttribute(doc, '[style]', 'style', cssNamesAHost) ||
    [...doc.querySelectorAll('style')].some((style) => cssNamesAHost(style.textContent));

  // Pictures inside the mail (`cid:`): replaced by the opened `data:` image once the reader allowed images and it is open.
  const embedded: string[] = [];
  for (const image of doc.querySelectorAll('img[src]')) {
    const source = image.getAttribute('src') ?? '';
    if (EMBEDDED_URL.test(source)) {
      embedded.push(source);
      const data = allowImages ? opened.get(normalizeCid(source)) : undefined;
      if (data !== undefined) {
        image.setAttribute('src', data);
      }
    }
  }

  neutralise(doc, allowImages);
  // PX-15: the frame parses the TEXT of this document, not the tree walked above, and markup can be read differently the second time: a `<link>` that is
  // text in the first tree can be an element in the second (`<form><math><mtext></form><form><mglyph><style></math><link ...>`). So the text is read back and
  // made safe again until it stops changing (`settle`, four passes at most); the frame then gets a tree that this function would not change.
  const settled = settle(serialise(doc), (current) => {
    const again = new DOMParser().parseFromString(current, 'text/html');
    neutralise(again, allowImages);
    return serialise(again);
  });
  if (settled !== undefined) {
    return { srcDoc: settled, hasRemoteImages, embedded };
  }
  // The markup never settled into one reading: show none of it.
  const empty = new DOMParser().parseFromString(
    '<!DOCTYPE html><html><head><meta charset="utf-8" /></head><body></body></html>',
    'text/html'
  );
  neutralise(empty, allowImages);
  return { srcDoc: serialise(empty), hasRemoteImages, embedded };
}
