// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT } from './helpers/scan';

// PX-3: a mail can make a browser fetch an address as soon as it is opened if its markup carries a <link rel="prerender"> (the policy of the
// frame does not stop that one), a <base> that re-aims relative addresses, or a ping attribute. `buildMailDocument` takes them out and switches DNS
// prefetch off. Building the document needs a DOM, and neither Node nor workerd has one, so this test reads the source for the steps. The same
// steps are proved against a fake tracker in real browsers by `scripts/frame-probe.mjs` (docs/development.md), run by hand before a release; the last
// describe below keeps that script tied to the frame it tests.

const source = readFileSync(path.join(ROOT, 'src', 'client', 'lib', 'mailDocument.ts'), 'utf8');

/** The position of the first match of `pattern` in the source, or -1. */
const at = (pattern: RegExp): number => source.search(pattern);

describe('the document of the mail frame (src/client/lib/mailDocument.ts)', () => {
  it('removes every <link> and every <base> of the sender, wherever they are', () => {
    expect(source).toMatch(/querySelectorAll\(\s*'link, base'\s*\)/);
    expect(source).toMatch(/for \(const element of doc\.querySelectorAll\('link, base'\)\) \{\s*element\.remove\(\);/);
  });

  it('removes every ping attribute', () => {
    expect(source).toMatch(/querySelectorAll\(\s*'\[ping\]'\s*\)/);
    expect(source).toMatch(/removeAttribute\(\s*'ping'\s*\)/);
  });

  it('removes a refresh and a DNS prefetch switch of the sender', () => {
    expect(source).toMatch(/meta\[http-equiv="refresh" i\]/);
    expect(source).toMatch(/meta\[http-equiv="x-dns-prefetch-control" i\]/);
  });

  it('puts the DNS prefetch switch (off) first in the head, then the policy, then the referrer policy', () => {
    expect(source).toMatch(/dns\.httpEquiv = 'x-dns-prefetch-control'/);
    expect(source).toMatch(/dns\.content = 'off'/);
    // Each one is inserted before the first child, so the last one inserted is the first one in the document.
    const order = [/insertBefore\(base,/, /insertBefore\(referrer,/, /insertBefore\(policy,/, /insertBefore\(dns,/].map(at);
    expect(order.every((position) => position > 0)).toBe(true);
    expect(order).toEqual(order.toSorted((a, b) => a - b));
    // The sender's elements go before the document gets its own <base> and metas.
    expect(at(/'link, base'/)).toBeLessThan(at(/createElement\('base'\)/));
  });

  it('takes every remote address out of the document while images are off, and only then: the policy alone is not enough (Firefox and srcset)', () => {
    // The call is guarded, is part of the neutralising step, which first runs on the markup after hasRemoteImages was worked out from it, and comes before the
    // document gets its own metas.
    expect(source).toMatch(/if \(!allowImages\) \{\s*dropRemoteAddresses\(doc\);\s*\}/);
    expect(at(/const hasRemoteImages/)).toBeLessThan(at(/\n {2}neutralise\(doc, allowImages\);/));
    expect(at(/function neutralise/)).toBeLessThan(at(/dropRemoteAddresses\(doc\);/));
    expect(at(/dropRemoteAddresses\(doc\);/)).toBeLessThan(at(/createElement\('base'\)/));
    // srcset and sizes go whatever they hold; any other attribute goes when its value names a host, not only a list of names; a link's target stays.
    expect(source).toMatch(/name === 'srcset' \|\| name === 'sizes'/);
    expect(source).toMatch(/!READ_AS_TEXT\.has\(name\) && !\(followed && name === 'href'\) && namesAHost\(value\)/);
    expect(source).toMatch(/removeAttribute\(attribute\)/);
    expect(source).toMatch(/element\.matches\('a, area'\)/);
    // Style sheets and style attributes lose their remote addresses too.
    expect(source).toMatch(/withoutRemoteCss\(value\)/);
    expect(source).toMatch(/withoutRemoteCss\(style\.textContent\)/);
  });

  it('removes speculation rules, whose addresses are in a script text, in both states', () => {
    expect(source).toMatch(/querySelectorAll\('script\[type="speculationrules" i\]'\)/);
    expect(at(/speculationrules/)).toBeLessThan(at(/if \(!allowImages\)/));
  });

  it('reads the document back from its own text and makes it safe again until the text stops changing (PX-15: the frame parses the text, not the tree)', () => {
    // One function does all the neutralising, so that it can run on any tree: the first one, and every tree read back from the text.
    expect(source).toMatch(/function neutralise\(doc: Document, allowImages: boolean\): void \{/);
    expect(source).toMatch(/import \{ settle \} from '\.\/mailSettle'/);
    expect(source).toMatch(
      /settle\(serialise\(doc\), \(current\) => \{\s*const again = new DOMParser\(\)\.parseFromString\(current, 'text\/html'\);\s*neutralise\(again, allowImages\);\s*return serialise\(again\);/
    );
    // What it hands to the frame is the settled text, and nothing else.
    expect(source).toMatch(/if \(settled !== undefined\) \{\s*return \{ srcDoc: settled, hasRemoteImages, embedded \};/);
    // A text that never settles shows an empty document, itself made safe.
    expect(source).toMatch(
      /const empty = new DOMParser\(\)\.parseFromString\(\s*'<!DOCTYPE html><html><head><meta charset="utf-8" \/><\/head><body><\/body><\/html>',\s*'text\/html'\s*\);\s*neutralise\(empty, allowImages\);/
    );
    expect(source).not.toMatch(/srcDoc: `<!DOCTYPE html>\${doc\.documentElement\.outerHTML}`/);
    // Our own head elements are removed first, so that a second run adds them once; the sender's policy and referrer metas go with them.
    expect(source).toMatch(/meta\[http-equiv="content-security-policy" i\], meta\[name="referrer" i\]/);
    expect(at(/meta\[name="referrer" i\]/)).toBeLessThan(at(/createElement\('base'\)/));
    // The loop is the pure function of mailSettle.ts, tested without a DOM in test/client/mail-settle.test.ts: four rereadings at most.
    const loop = readFileSync(path.join(ROOT, 'src', 'client', 'lib', 'mailSettle.ts'), 'utf8');
    expect(loop).toMatch(/export const MAX_PASSES = 4;/);
    expect(loop).toMatch(
      /for \(let pass = 0; pass < MAX_PASSES; pass \+= 1\) \{\s*const next = reread\(text\);\s*if \(next === text\) \{\s*return text;/
    );
  });

  it('keeps the policy closed: nothing but inline styles, data: fonts and, after Show images, https and data pictures', () => {
    const policy = /framePolicy = \(images: string\): string =>\s*`([^`]*)`/.exec(source)?.[1] ?? '';
    expect(policy).not.toBe('');
    expect(policy).toContain("default-src 'none'");
    expect(policy).toContain("frame-src 'none'");
    expect(policy).toContain('font-src data:');
    expect(policy).not.toMatch(/unsafe-eval|connect-src|script-src|media-src|object-src/);
    expect(source).toMatch(/framePolicy\(allowImages \? 'data: https:' : 'data:'\)/);
  });

  it('is the only place that builds the document: MailFrame asks for it and parses nothing itself', () => {
    const frame = readFileSync(path.join(ROOT, 'src', 'client', 'components', 'MailFrame.tsx'), 'utf8');
    expect(frame).toMatch(/from '\.\.\/lib\/mailDocument'/);
    expect(frame).not.toContain('DOMParser');
    expect(frame).toMatch(/sandbox="allow-popups allow-popups-to-escape-sandbox"/);
  });
});

// A home directory, a hidden tool directory of a maintainer, a tilde path: built from pieces so that this file does not contain what it forbids.
const OUTSIDE = new RegExp(
  [
    ['/ho', 'me/'],
    [String.raw`\.her`, 'mes'],
    ['~', '/']
  ]
    .map((parts) => parts.join(''))
    .join('|')
);

describe('the browser probe of the frame (scripts/frame-probe.mjs)', () => {
  const probe = readFileSync(path.join(ROOT, 'scripts', 'frame-probe.mjs'), 'utf8');
  const page = readFileSync(path.join(ROOT, 'scripts', 'frame-probe-page.mjs'), 'utf8');
  const frame = readFileSync(path.join(ROOT, 'src', 'client', 'components', 'MailFrame.tsx'), 'utf8');
  const ids = [...probe.matchAll(/^\s+probe\(\s*'([a-z0-9-]+)'/gm)].map((match) => match[1]);

  it('tests the very function and the very sandbox of the app', () => {
    expect(page).toMatch(/from '\.\.\/src\/client\/lib\/mailDocument\.ts'/);
    expect(frame).toMatch(/import \{ buildMailDocument \} from '\.\.\/lib\/mailDocument'/);
    // The probe reads the sandbox value out of MailFrame.tsx with this pattern: it must find one, and it must be the closed one.
    expect(probe).toContain(String.raw`const match = /<iframe[^>]*\bsandbox="([^"]+)"/s.exec(source)`);
    const sandbox = /<iframe[^>]*\bsandbox="([^"]+)"/s.exec(frame)?.[1] ?? '';
    expect(sandbox.split(' ').toSorted()).toEqual(['allow-popups', 'allow-popups-to-escape-sandbox']);
  });

  it('serves the page with the policy of public/_headers, and reads it from that file', () => {
    expect(probe).toMatch(/readFileSync\(path\.join\(root, 'public\/_headers'\)/);
    const headers = readFileSync(path.join(ROOT, 'public', '_headers'), 'utf8');
    expect(headers).toMatch(/^\/\*\n\s+Content-Security-Policy: /m);
  });

  it('has a probe for every way in that the pentest found, with unique ids', () => {
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeGreaterThanOrEqual(85);
    // A harmless probe goes first, so that the first real one is not judged on what a browser opens while the page settles.
    expect(ids[0]).toBe('warm-up');
    for (const id of [
      'img',
      'img-srcset',
      'img-sizes',
      'img-src-data-srcset',
      'picture',
      'picture-img-data',
      'picture-media',
      'img-src-tab',
      'img-src-backslash',
      'data-attribute',
      // PX-15: what the parser reads differently the second time (the pentest's mXSS set; the first four leaked, the others are shapes that did not).
      'mxss-form-math',
      'mxss-fm-link-prerender',
      'mxss-fm-img-srcset',
      'mxss-fm-picture',
      'mxss-fm-link-stylesheet',
      'mxss-fm-img-src',
      'mxss-fm-meta-refresh',
      'mxss-fm-base-a',
      'mxss-noscript-title',
      'mxss-svg-style-a',
      'mxss-select-style',
      'mxss-math-mi-style',
      'mxss-dompurify',
      'mxss-comment-link',
      'svg-image-xlink',
      'video-source-src',
      'css-bg',
      'css-import',
      'link-stylesheet',
      'link-prefetch',
      'link-preload',
      'link-preconnect',
      'link-dns-prefetch',
      'link-prerender',
      'link-prerender-body',
      'link-modulepreload',
      'base-img',
      'base-body-img',
      'meta-refresh',
      'meta-dns-on',
      'speculation',
      'click-ping',
      'click-ping-url',
      'click-javascript',
      'click-data',
      'click-link',
      'script',
      'iframe-srcdoc'
    ]) {
      expect(ids, id).toContain(id);
    }
  });

  it('judges the document (no remote address while images are off), the favicon, the speculative connections and the clicks as docs/development.md says', () => {
    // The server requires the page's own count of remote addresses to be zero; the page counts them with code of its own.
    expect(probe).toMatch(/shape\.remote === 0/);
    expect(probe).toMatch(/shape\.refresh === 0/);
    expect(page).toMatch(/refresh: parsed\.querySelectorAll\('meta\[http-equiv="refresh" i\]'\)\.length/);
    expect(page).toMatch(/function remoteIn\(parsed\)/);
    expect(page).toMatch(/checks: checksOfTheDocument\(\)/);
    // A followed link's window asks for its icon: not counted. A request without a probe id is not given to the last probe marked.
    expect(probe).toMatch(/url === '\/favicon\.ico'/);
    expect(probe).toMatch(/state\.strays\.push/);
    // Only a connection with no request of the two probes that browsers connect for by themselves is a note.
    expect([...probe.matchAll(/speculative: true/g)]).toHaveLength(2);
    expect(probe).toMatch(/probe\('img', .*speculative: true/);
    expect(probe).toMatch(/probe\('iframe', .*speculative: true/);
    // A click is reported by the page (for a driver) or by the server (a plain request); the button under the frame is for a person.
    expect(page).toMatch(/globalThis\.__probeClicked = async \(id\)/);
    expect(page).toMatch(/button\.dataset\.clicked = item\.id/);
    expect(probe).toMatch(/pathname\.startsWith\('\/clicked\/'\)/);
  });

  it('runs once: a probe is marked only before the report, the first report counts, and no link of a probe opens the probe page itself', () => {
    expect(probe).toMatch(
      /startsWith\('\/mark\/'\) && byId\.has\(pathname\.slice\(6\)\)\) \{[^}]*if \(state\.report === null\) \{\s*state\.current = pathname\.slice\(6\);/
    );
    expect(probe).toMatch(
      /case 'POST \/report': \{\s*const report = JSON\.parse\(await readBody\(request\)\);\s*if \(state\.report !== null\) \{/
    );
    expect(probe).toMatch(/reported: state\.report !== null/);
    expect(page).toMatch(/if \(config\.reported\) \{/);
    // A `#` link inside a srcdoc frame resolves against the probe page and opens it again in a new window (truong, P-1).
    expect(probe).not.toContain('href="#"');
    expect(probe).toMatch(/probe\('click-ping', \(t\) => `<a id=l href="about:blank" ping=/);
  });

  it('judges the control run by the canaries the engine acts on: Firefox does not act on <link rel=prerender>, so it is no canary there', () => {
    // Three canaries everywhere; the prerender one only where the engine fetches a prerender link (Chromium).
    expect(probe).toMatch(/const CANARIES = \['img', 'css-bg', 'link-stylesheet'\];/);
    expect(probe).toMatch(/const PRERENDER_CANARY = 'link-prerender';/);
    expect(probe).toMatch(/const ENGINES_THAT_PRERENDER = new Set\(\['chromium'\]\);/);
    // Every canary the engine acts on must leak; one that does not, or none at all, is BLIND, and the summary says what was expected and what leaked.
    expect(probe).toMatch(/const missing = expected\.filter\(\(id\) => !leaked\.includes\(id\)\);\s*const seen = missing\.length === 0;/);
    expect(probe).toMatch(/CONTROL BLIND \(\$\{engine\}\)/);
    expect(probe).toMatch(/CONTROL OK \(\$\{engine\}\)/);
    expect(probe).toMatch(/expected: \$\{expected\.join\(', '\)\}; leaked: \$\{leaked\.join\(', '\) \|\| 'none'\}/);
    // The engine comes from the user agent of the page, or from --engine=.
    expect(page).toMatch(/function engineOfThisBrowser\(\)/);
    expect(page).toMatch(/engine: engineOfThisBrowser\(\)/);
    expect(probe).toMatch(/--engine= must be chromium, firefox or webkit/);
    // The probes whose only way to the network is a prerender link are named, they exist, and the probes with srcset are not among them (they are the ones that
    // still check the network in Firefox).
    const named = /const PRERENDER_ONLY = new Set\(\[([^\]]*)\]\)/.exec(probe)?.[1] ?? '';
    const prerenderOnly = [...named.matchAll(/'([a-z0-9-]+)'/g)].map((match) => match[1]);
    expect(prerenderOnly.length).toBeGreaterThanOrEqual(2);
    for (const id of prerenderOnly) {
      expect(ids, id).toContain(id);
    }
    expect(prerenderOnly).toEqual(expect.arrayContaining(['link-prerender', 'mxss-form-math', 'mxss-fm-link-prerender']));
    expect(prerenderOnly).not.toContain('mxss-fm-img-srcset');
    expect(prerenderOnly).not.toContain('mxss-fm-picture');
    // And docs/development.md says plainly what a Firefox pass on those rows is worth.
    const docs = readFileSync(path.join(ROOT, 'docs', 'development.md'), 'utf8');
    expect(docs).toMatch(/a pass on the prerender rows in Firefox proves nothing about the network/);
  });

  it('marks every probe that needs a click, and only those', () => {
    const clicks = ids.filter((id) => id.startsWith('click-'));
    expect(clicks.length).toBeGreaterThanOrEqual(7);
    expect([...probe.matchAll(/click: true/g)]).toHaveLength(clicks.length);
  });

  it('names no path outside the repository and no maintainer value', () => {
    for (const [name, content] of [
      ['frame-probe.mjs', probe],
      ['frame-probe-page.mjs', page],
      ['development.md', readFileSync(path.join(ROOT, 'docs', 'development.md'), 'utf8')]
    ]) {
      expect(content, name).not.toMatch(OUTSIDE);
    }
  });
});
