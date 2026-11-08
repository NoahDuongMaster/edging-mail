#!/usr/bin/env node
// Mail frame probe: runs the mail frame of the app against a fake tracker in a real browser, so that a maintainer can check that opening a hostile mail
// reaches nothing on the network (the rules of the frame in docs/security.md). It adds no dependency: like kat-browser.mjs it uses the esbuild of this
// repo, to bundle the page (scripts/frame-probe-page.mjs) with src/client/lib/mailDocument.ts, the very function the app calls.
//
//   node scripts/frame-probe.mjs            Serves the page and prints its address: open it in any browser on this machine (Chrome, Firefox, Safari). The table
//                                           of verdicts appears on the page and in this terminal when every probe has run (about a minute).
//   node scripts/frame-probe.mjs --wait     The same, then exits 0 (every probe passed) or 1 (a probe failed) once the page has reported, and 2 when no page
//                                           reported in time: for a script that opens the address with a browser driver such as Playwright.
//   node scripts/frame-probe.mjs --control  Runs the probes with the protection OFF (the raw mail in the same sandbox). It must show leaks: it proves that the
//                                           probe can see one. Exits 0 when it did and 1 when it is blind (then a pass in the normal run means nothing). It must see
//                                           a leak from every canary that the engine acts on: `img`, `css-bg` and `link-stylesheet` in every engine, and
//                                           `link-prerender` only where the engine fetches a prerender link (Chromium; Firefox never does, and WebKit is taken not to, so it cannot
//                                           leak there). The summary says which canaries it expected and which leaked, and for which engine.
//   Options: --port=8801 (the page), --tracker-port=9101 (the fake tracker), --timeout=240 (seconds to wait for the page with --wait),
//            --engine=chromium|firefox|webkit (the engine is read from the user agent of the page; this says it when the user agent cannot).
//
// How it works: ONE page puts each probe (a hostile mail, written as data below) through buildMailDocument and into a sandboxed srcdoc iframe, one after
// the other, with the same `sandbox` value as MailFrame.tsx (read from that file, so it cannot drift). The page is served with the policy of
// public/_headers, with ONE change: the address of the tracker is added to the fetch directives of that policy. A srcdoc frame inherits the policy of its
// parent, so without the change the parent alone would block an http tracker and hide a failure of the frame's own policy; with it, only the frame's own
// policy, the sandbox and the document are being tested. The tracker listens on 127.0.0.1 only and answers 404 to everything: nothing leaves this machine.
//
// A probe PASSES when nothing reached the tracker (no request, and no connection without a request, which is what `preconnect` makes), no script of the
// mail ran, and the built document has no <link>, no <base href>, no ping attribute and NO ADDRESS OF ANOTHER HOST (the document itself carries none while
// images are off: Firefox does not apply the policy of the frame to srcset and <picture>, so the policy alone is not enough), and starts with the DNS
// prefetch switch. A few more checks of the same document with images ALLOWED (what Show images lets through is kept) run beside the probes.
//
// Notes, not failures: a connection with no request, for the probes marked `speculative` (`img`, `iframe`): some browsers open a speculative connection for
// those before they look at the policy; nothing is asked for or sent, and the document names no address (the probe checks that first), so it is listed as a
// note. Requests for /favicon.ico are not counted: a browser asks for it for the window of a link that was followed on purpose. Any other request without the id of a
// probe in its path is listed as (unattributed) and fails.
//
// A probe marked `click` needs a person (or a driver) to click the link in its frame (the iframe's title is the id of the probe; the link has the id `l`), and
// then to SAY so: the button under the frame, `window.__probeClicked(id)` on the page, or `POST /clicked/<id>` on the server. It stays `manual` until it has
// leaked (fail) or has been clicked (pass), and /result.json always shows its state. Click after the table has appeared. A link that a person follows on purpose
// (`byDesign`) opens the sender's address in a new window and must send no referrer. The page carries `data-result="pass|fail"`, and so does every row of its table.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argument = (name, fallback) => process.argv.find((item) => item.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const flag = (name) => process.argv.includes(`--${name}`);
const PAGE_PORT = Number(argument('port', '8801'));
const TRACKER_PORT = Number(argument('tracker-port', '9101'));
const WAIT_SECONDS = Number(argument('timeout', '240'));
const WAIT = flag('wait');
const CONTROL = flag('control');
const ENGINE_ARG = argument('engine');
if (ENGINE_ARG !== undefined && !['chromium', 'firefox', 'webkit'].includes(ENGINE_ARG)) {
  process.stderr.write(`--engine= must be chromium, firefox or webkit, not ${ENGINE_ARG}\n`);
  process.exit(2);
}
const TRACKER = `http://127.0.0.1:${TRACKER_PORT}`;
const PAUSE_MS = 900;

// The probes. `html` gets `t(rest)`, an address on the tracker that carries the id of the probe, and the id. `click`: needs a click on the link of the frame.
// `byDesign`: the click opens the sender's address on purpose (new window, no referrer). `forbidden`: a request whose address ends in it is a leak even then.
// `speculative`: a connection with no request is a note, not a failure (see the top).
const probe = (id, html, options = {}) => ({ id, html, ...options });
const GIF = 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';
const MUTATION = (inner) => `<form><math><mtext></form><form><mglyph><style></math>${inner}`;
const probes = [
  probe('warm-up', () => '<p>warm-up: nothing in this mail names an address</p>'),
  probe('img', (t) => `<img src="${t('img')}">`, { speculative: true }),
  probe('img-srcset', (t) => `<img srcset="${t('x')} 1x">`),
  probe('img-sizes', (t) => `<img srcset="${t('x')} 100w" sizes="100px">`),
  probe('img-src-data-srcset', (t) => `<img src="${GIF}" srcset="${t('x')} 1x">`),
  probe('picture', (t) => `<picture><source srcset="${t('x')}"><img></picture>`),
  probe('picture-img-data', (t) => `<picture><source srcset="${t('x')}"><img src="${GIF}"></picture>`),
  probe(
    'picture-media',
    (t) => `<picture><source media="(min-width:1px)" type="image/png" srcset="${t('a')} 1x, ${t('b')} 2x"><img></picture>`
  ),
  probe('img-src-tab', (t) => `<img src="${t('x').replace('http:', 'ht&#9;tp:')}">`),
  probe('img-src-backslash', (t) => `<img src="${t('x').replaceAll('/', '\\')}">`),
  probe('data-attribute', (t) => `<div data-src="${t('x')}" data-background="${t('y')}">x</div>`),
  probe('input-image', (t) => `<input type=image src="${t('x')}">`),
  probe('body-bg', (t) => `<table background="${t('table')}"><tr><td background="${t('td')}">x</td></tr></table>`),
  probe('css-bg', (t) => `<div style="background:url(${t('x')});width:50px;height:50px">x</div>`),
  probe('css-import', (t) => `<style>@import url(${t('x.css')});</style>x`),
  probe('css-font', (t) => `<style>@font-face{font-family:f;src:url(${t('x.woff')})}body{font-family:f}</style>x`),
  probe('link-stylesheet', (t) => `<link rel=stylesheet href="${t('x.css')}">x`),
  probe('link-prefetch', (t) => `<link rel=prefetch href="${t('x')}">x`),
  probe('link-preload', (t) => `<link rel=preload as=image href="${t('x')}">x`),
  probe('link-preconnect', () => `<link rel=preconnect href="${TRACKER}">x`),
  probe('link-dns-prefetch', () => `<link rel=dns-prefetch href="//tracker-dns.invalid">x`),
  probe('link-prerender', (t) => `<link rel=prerender href="${t('x')}">x`),
  probe('link-prerender-body', (t) => `<p>x</p><div><link rel=prerender href="${t('x')}"></div>`),
  probe('video-poster', (t) => `<video poster="${t('x')}"></video>`),
  probe('video-src', (t) => `<video src="${t('x')}" preload=auto></video>`),
  probe('video-source-src', (t) => `<video preload=auto><source src="${t('x')}"></video>`),
  probe('audio-src', (t) => `<audio src="${t('x')}" preload=auto></audio>`),
  probe('object', (t) => `<object data="${t('x')}"></object>`),
  probe('embed', (t) => `<embed src="${t('x')}">`),
  probe('iframe', (t) => `<iframe src="${t('x')}"></iframe>`, { speculative: true }),
  probe('svg-image', (t) => `<svg width=10 height=10><image href="${t('x')}" width=10 height=10/></svg>`),
  probe('svg-image-xlink', (t) => `<svg width=10 height=10><image xlink:href="${t('x')}" width=10 height=10 /></svg>`),
  probe(
    'svg-feimage',
    (t) => `<svg width=10 height=10><filter id=f><feImage href="${t('x')}"/></filter><rect width=10 height=10 filter="url(#f)"/></svg>`
  ),
  probe('svg-use', (t) => `<svg><use href="${t('x.svg')}#a"/></svg>`),
  probe('meta-refresh', (t) => `<meta http-equiv="refresh" content="0;url=${t('x')}">x`),
  probe('base-img', (t) => `<base href="${t('base/')}"><img src="rel.png">`),
  probe('base-body-img', (t) => `<p>x</p><base href="${t('base/')}"><img src="rel.png">`),
  probe(
    'meta-dns-on',
    () => `<meta http-equiv="x-dns-prefetch-control" content="on"><link rel=dns-prefetch href="//tracker-dns2.invalid">x`
  ),
  probe('script', (t, id) => `<script>parent.postMessage('exec:${id}','*')</script>x`),
  probe('onerror', (t, id) => `<img src=x onerror="parent.postMessage('exec:${id}','*')">`),
  probe('onload-svg', (t, id) => `<svg onload="parent.postMessage('exec:${id}','*')"></svg>`),
  probe('iframe-srcdoc', (t, id) => `<iframe srcdoc="<script>parent.parent.postMessage('exec:${id}','*')</script>"></iframe>`),
  probe(
    'form-submit',
    (t) =>
      `<form action="${t('x')}" method=post id=f><input name=a value=b></form><script>document.getElementById('f').submit()</script><img src=x onerror="document.getElementById('f').submit()">`
  ),
  probe('link-next', (t) => `<link rel=next href="${t('x')}">x`),
  probe('link-modulepreload', (t) => `<link rel=modulepreload href="${t('x.js')}">x`),
  probe('link-preload-fetch', (t) => `<link rel=preload as=fetch crossorigin href="${t('x')}">x`),
  probe('link-preload-font', (t) => `<link rel=preload as=font crossorigin href="${t('x')}">x`),
  probe('link-preload-style', (t) => `<link rel=preload as=style href="${t('x')}">x`),
  probe('link-icon', (t) => `<link rel=icon href="${t('x')}">x`),
  probe('link-manifest', (t) => `<link rel=manifest href="${t('x')}">x`),
  probe('link-alternate', (t) => `<link rel=alternate type="application/rss+xml" href="${t('x')}">x`),
  probe('link-prefetch-doc', (t) => `<link rel=prefetch as=document href="${t('x')}">x`),
  probe('link-preconnect-crossorigin', () => `<link rel=preconnect href="${TRACKER}" crossorigin>x`),
  probe('link-prerender-https', (t) => `<link rel=prerender href="${t('x').replace('http:', 'https:')}">x`),
  probe('link-prerender-proto-relative', (t) => `<link rel=prerender href="${t('x').replace('http:', '')}">x`),
  probe(
    'speculation',
    (t) =>
      `<script type="speculationrules">{"prefetch":[{"source":"list","urls":["${t('a')}"]}],"prerender":[{"source":"list","urls":["${t('b')}"]}]}</script>x`
  ),
  probe('a-prefetch', (t) => `<a href="${t('x')}" rel="prefetch">x</a>`),
  probe('img-loading-lazy', (t) => `<img loading=lazy src="${t('x')}">`),
  probe('img-lazy-below', (t) => `<div style="height:3000px"></div><img loading=lazy src="${t('x')}">`),
  probe('img-data-svg', (t) => `<img src="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'><image href='${t('x')}'/></svg>">`),
  probe('img-proto-relative', (t) => `<img src="${t('x').replace('http:', '')}">`),
  probe('noscript-img', (t) => `<noscript><img src="${t('x')}"></noscript>x`),
  probe('css-cursor', (t) => `<div style="cursor:url(${t('x')}),auto;width:50px;height:50px">x</div>`),
  probe('css-list', (t) => `<ul style="list-style-image:url(${t('x')})"><li>x</li></ul>`),
  probe('css-content', (t) => `<style>p::before{content:url(${t('x')})}</style><p>x</p>`),
  probe(
    'css-mask',
    (t) => `<div style="mask-image:url(${t('x')});-webkit-mask-image:url(${t('x')});width:50px;height:50px;background:#000">x</div>`
  ),
  probe('css-border-image', (t) => `<div style="border:10px solid;border-image:url(${t('x')}) 10;width:50px;height:50px">x</div>`),
  probe('css-image-set', (t) => `<div style="background-image:image-set('${t('x')}' 1x);width:50px;height:50px">x</div>`),
  probe('css-image-set-url', (t) => `<div style="background:image-set(url(${t('x')}) 1x);width:50px;height:50px">x</div>`),
  // PX-15: markup that the parser reads differently the second time. The frame parses the TEXT of the built document, not the tree that was checked, so a
  // <link> or an srcset that is no element in the first reading can be one in the second. `FM` is the form/math/mglyph mutation (it leaked in Chromium for a
  // link and in Firefox for srcset and picture, with no click, before the document was built until it stopped changing); the others are shapes that did not leak.
  // `mxss-form-math` and `mxss-fm-link-prerender` are the same markup under the two names of the pentest.
  probe('mxss-form-math', (t) => `<form><math><mtext></form><form><mglyph><style></math><link rel=prerender href="${t('a')}">`),
  probe('mxss-fm-link-prerender', (t) => MUTATION(`<link rel=prerender href="${t('a')}">`)),
  probe('mxss-fm-img-srcset', (t) => MUTATION(`<img srcset="${t('a')} 1x">`)),
  probe('mxss-fm-picture', (t) => MUTATION(`<picture><source srcset="${t('a')}"><img></picture>`)),
  probe('mxss-fm-link-stylesheet', (t) => MUTATION(`<link rel=stylesheet href="${t('a')}">`)),
  probe('mxss-fm-img-src', (t) => MUTATION(`<img src="${t('a')}">`)),
  probe('mxss-fm-meta-refresh', (t) => MUTATION(`<meta http-equiv="refresh" content="0;url=${t('a')}">`)),
  probe('mxss-fm-base-a', () => MUTATION(`<base href="${TRACKER}/p/mxss-fm-base-a/"><a href="rel">x</a>`)),
  probe('mxss-noscript-title', (t) => `<noscript><p title="</noscript><link rel=prerender href='${t('a')}'>"></noscript>x`),
  probe('mxss-svg-style-a', (t) => `<svg></p><style><a id="</style><link rel=prerender href='${t('a')}'>"></style>x`),
  probe(
    'mxss-select-style',
    (t) => `<select><template><style><a id="</style><link rel=prerender href='${t('a')}'>"></a></style></template></select>x`
  ),
  probe('mxss-math-mi-style', (t) => `<math><mi><mglyph><style></math><link rel=prerender href="${t('a')}">`),
  probe(
    'mxss-dompurify',
    (t) => `<math><mtext><table><mglyph><style><!--</style><img title="--&gt;&lt;/mglyph&gt;&lt;link rel=prerender href=${t('a')}&gt;">`
  ),
  probe('mxss-comment-link', (t) => `<!--><link rel=prerender href="${t('a')}">--><p>x</p>`),
  probe('click-link', (t) => `<a id=l href="${t('x')}">click</a>`, { click: true, byDesign: true }),
  probe('click-referrer', (t) => `<a id=l href="${t('x')}">click</a>`, { click: true, byDesign: true }),
  // The link opens a blank window, not the probe page: a `#` link would open this page again, and its probes would run a second time.
  probe('click-ping', (t) => `<a id=l href="about:blank" ping="${t('x')}">click</a>`, { click: true }),
  probe('click-ping-url', (t) => `<a id=l href="${t('target')}" ping="${t('report')}">click</a>`, {
    click: true,
    byDesign: true,
    forbidden: 'report'
  }),
  probe('click-javascript', (t) => `<a id=l href="javascript:void(window.name='x',location='${t('ran')}')">click</a>`, { click: true }),
  probe('click-javascript-tab', (t) => `<a id=l href="java&#x09;script:void(window.name='x',location='${t('ran')}')">click</a>`, {
    click: true
  }),
  probe('click-data', (t) => `<a id=l href="data:text/html,<script>location='${t('ran')}'</script>">click</a>`, { click: true })
];
// With --control the probe is trusted only if every canary that the engine acts on leaked: these three in every engine, and `link-prerender` in the engines
// that fetch a prerender link. Chromium does; Firefox does not act on `<link rel=prerender>` at all (seen in real runs) and WebKit is taken not to (never run), so
// there it can never leak and is no canary.
const CANARIES = ['img', 'css-bg', 'link-stylesheet'];
const PRERENDER_CANARY = 'link-prerender';
const ENGINES_THAT_PRERENDER = new Set(['chromium']);
// Probes whose only way to the network is a `<link rel=prerender>` (the mutation probes `mxss-form-math` and `mxss-fm-link-prerender` among them). In an engine that
// does not act on it, a pass on these rows says nothing about the network: the document rules (no `<link>`, no remote address in the text the frame parses) and the
// probes with `srcset` (`mxss-fm-img-srcset`, `mxss-fm-picture`) are what check them there. The row says so as a note.
const PRERENDER_ONLY = new Set([
  'link-prerender',
  'link-prerender-body',
  'link-prerender-https',
  'link-prerender-proto-relative',
  'mxss-form-math',
  'mxss-fm-link-prerender',
  'mxss-noscript-title',
  'mxss-svg-style-a',
  'mxss-select-style',
  'mxss-math-mi-style',
  'mxss-dompurify',
  'mxss-comment-link'
]);

// The policy of the app (public/_headers, the block of `/*`) with the tracker added to what the frame could fetch or navigate to. See the top of the file.
const FETCH_DIRECTIVES = new Set([
  'default-src',
  'style-src',
  'font-src',
  'img-src',
  'frame-src',
  'media-src',
  'object-src',
  'form-action'
]);
function pageHeaders() {
  const lines = readFileSync(path.join(root, 'public/_headers'), 'utf8').split('\n');
  const start = lines.indexOf('/*');
  if (start === -1) {
    throw new Error('public/_headers has no /* block');
  }
  const headers = {};
  for (const line of lines.slice(start + 1)) {
    const match = /^\s+([A-Za-z-]+):\s*(.+)$/.exec(line);
    if (match === null) {
      break;
    }
    headers[match[1].toLowerCase()] = match[2].trim();
  }
  const policy = headers['content-security-policy'];
  if (policy === undefined) {
    throw new Error('public/_headers has no Content-Security-Policy in its /* block');
  }
  headers['content-security-policy'] = policy
    .split(';')
    .map((directive) => directive.trim())
    .filter(Boolean)
    .map((directive) => {
      const [name, ...values] = directive.split(/\s+/);
      if (!FETCH_DIRECTIVES.has(name)) {
        return directive;
      }
      return [name, ...values.filter((value) => value !== "'none'"), TRACKER].join(' ');
    })
    .join('; ');
  return headers;
}

/** The `sandbox` value of the iframe of MailFrame.tsx, so the probe cannot drift from the app. */
function frameSandbox() {
  const source = readFileSync(path.join(root, 'src/client/components/MailFrame.tsx'), 'utf8');
  const match = /<iframe[^>]*\bsandbox="([^"]+)"/s.exec(source);
  if (match === null) {
    throw new Error('MailFrame.tsx has no iframe with a sandbox attribute');
  }
  return match[1];
}

// --- server side --------------------------------------------------------------------------------------------------------------------------------------

const state = { hits: [], strays: [], connections: new Map(), clicked: new Set(), current: '', report: null };
const byId = new Map(probes.map((item) => [item.id, item]));

/** The engine of the page: `--engine=` if given, else what the page said from its user agent, else unknown. */
function engineName() {
  return ENGINE_ARG ?? state.report?.engine ?? 'unknown';
}

function judge(item) {
  const mine = state.hits.filter((hit) => hit.probe === item.id);
  const shape = state.report?.shapes?.[item.id];
  const ran = state.report?.exec?.includes(`exec:${item.id}`) === true;
  const hit = mine.map((entry) => `${entry.method} ${entry.url}`).join(', ');
  if (state.report === null) {
    return { result: 'fail', detail: 'the page has not reported' };
  }
  const shapeOk =
    shape?.links === 0 &&
    shape.baseWithHref === 0 &&
    shape.pings === 0 &&
    shape.remote === 0 &&
    shape.speculation === 0 &&
    shape.refresh === 0 &&
    shape.dnsFirst === true &&
    shape.dnsOn === 0;
  if (!CONTROL && !shapeOk) {
    return { result: 'fail', detail: `the built document is wrong: ${JSON.stringify(shape)}` };
  }
  if (ran) {
    return { result: 'fail', detail: 'a script of the mail ran' };
  }
  const reported = mine.filter((entry) => item.forbidden !== undefined && entry.url.endsWith(`/${item.forbidden}`));
  if (reported.length > 0) {
    return { result: 'fail', detail: `reached the tracker: ${reported.map((entry) => `${entry.method} ${entry.url}`).join(', ')}` };
  }
  if (item.byDesign && mine.some((entry) => entry.referer !== null)) {
    return { result: 'fail', detail: `the sender's address got a referrer: ${mine.find((entry) => entry.referer !== null).referer}` };
  }
  if (mine.length > 0 && !item.byDesign) {
    return { result: 'fail', detail: `reached the tracker: ${hit}` };
  }
  if (!item.click && mine.length === 0 && (state.connections.get(item.id) ?? 0) > 0) {
    if (item.speculative && !CONTROL) {
      return {
        result: 'pass',
        note: true,
        detail: 'blocked; note: a connection to the tracker with no request (a speculative connect of the browser, nothing was asked for)'
      };
    }
    return { result: 'fail', detail: 'a connection to the tracker with no request (preconnect)' };
  }
  if (item.byDesign && mine.length > 0) {
    return { result: 'pass', detail: 'followed on purpose, in a new window, with no referrer' };
  }
  if (item.click) {
    if (!state.clicked.has(item.id)) {
      return { result: 'manual', detail: 'not clicked yet (nothing leaked so far)' };
    }
    return item.byDesign
      ? { result: 'manual', detail: "clicked, but the sender's address was not requested (was the new window blocked?)" }
      : { result: 'pass', detail: 'clicked, nothing reached the tracker' };
  }
  if (!CONTROL && PRERENDER_ONLY.has(item.id) && !ENGINES_THAT_PRERENDER.has(engineName())) {
    return {
      result: 'pass',
      note: true,
      detail: `blocked; note: ${engineName()} does not act on <link rel=prerender>, so this row says nothing about the network there: the document rules and the probes with srcset check it`
    };
  }
  return { result: 'pass', detail: 'blocked' };
}

/** What the page checked on the document itself (images allowed, images off): a row each, beside the probes. */
function checkRows() {
  if (CONTROL || state.report === null) {
    return [];
  }
  return state.report.checks.map((check) => ({ id: `check-${check.id}`, result: check.ok ? 'pass' : 'fail', detail: check.detail }));
}

/** Requests the tracker could not give to a probe (no id in the path), apart from the favicon request of a followed link. */
function strayRow() {
  const found = state.strays.map((entry) => `${entry.method} ${entry.url}`);
  return found.length === 0
    ? { id: '(unattributed)', result: 'pass', detail: 'no request without the id of a probe' }
    : { id: '(unattributed)', result: 'fail', detail: `reached the tracker with no probe id: ${found.join(', ')}` };
}

function table() {
  const rows = [...probes.map((item) => ({ id: item.id, ...judge(item) })), ...checkRows(), strayRow()];
  const failed = rows.filter((row) => row.result === 'fail');
  const manual = rows.filter((row) => row.result === 'manual');
  const notes = rows.filter((row) => row.note === true);
  if (CONTROL) {
    const engine = engineName();
    const prerenders = ENGINES_THAT_PRERENDER.has(engine);
    const expected = prerenders ? [...CANARIES, PRERENDER_CANARY] : CANARIES;
    const leaked = expected.filter((id) => rows.find((row) => row.id === id)?.result === 'fail');
    const missing = expected.filter((id) => !leaked.includes(id));
    const seen = missing.length === 0;
    const list = `expected: ${expected.join(', ')}; leaked: ${leaked.join(', ') || 'none'}`;
    return {
      rows,
      engine,
      canaries: { expected, leaked },
      overall: seen ? 'pass' : 'fail',
      summary: seen
        ? `CONTROL OK (${engine}): with the protection off ${failed.length} of ${rows.length} rows leak, and every canary this engine acts on did (${list})${prerenders ? '' : `; ${PRERENDER_CANARY} is no canary here: ${engine} does not act on <link rel=prerender>, so a pass on the prerender rows proves nothing about the network`}: the probe can see a leak.`
        : `CONTROL BLIND (${engine}): with the protection off these canaries did not leak: ${missing.join(', ')} (${list}). A pass in the normal run means nothing.`
    };
  }
  return {
    rows,
    overall: failed.length === 0 ? 'pass' : 'fail',
    summary:
      failed.length === 0
        ? `PASS: ${rows.length - manual.length} of ${rows.length} probes and checks passed (${notes.length} with a note), ${manual.length} need a click.`
        : `FAIL: ${failed.length} of ${rows.length} probes and checks failed: ${failed.map((row) => row.id).join(', ')}.`
  };
}

function print(answer) {
  for (const row of answer.rows) {
    process.stdout.write(`FRAME|${row.result.toUpperCase()}|${row.id}|${row.detail}\n`);
  }
  process.stdout.write(`${answer.summary}\n`);
}

const trackerServer = createServer((request, response) => {
  const url = request.url ?? '';
  const id = /^\/p\/([^/]+)\//.exec(url)?.[1];
  // A browser asks the address of a followed link for its icon: not the mail's doing. A request with no id in its path is not given to the probe marked last.
  if (url === '/favicon.ico') {
    // Nothing: it is neither a hit nor a stray.
  } else if (id === undefined) {
    state.strays.push({ method: request.method, url });
  } else {
    state.hits.push({ probe: id, method: request.method, url, referer: request.headers.referer ?? null });
  }
  response.writeHead(404, { 'content-type': 'text/plain', connection: 'close' }).end('x');
});
trackerServer.on('connection', () => {
  state.connections.set(state.current, (state.connections.get(state.current) ?? 0) + 1);
});

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > 1_000_000) {
        request.destroy();
        reject(new Error('body too large'));
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}

const headers = pageHeaders();
const sandbox = frameSandbox();
const bundle = await build({
  entryPoints: [path.join(root, 'scripts/frame-probe-page.mjs')],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  write: false,
  logLevel: 'warning'
});
const pageScript = bundle.outputFiles[0].text;
const pageConfig = () => JSON.stringify({ sandbox, control: CONTROL, pause: PAUSE_MS, reported: state.report !== null });
const pageHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Running: mail frame probe</title>
    <link rel="stylesheet" href="/probe.css" />
  </head>
  <body>
    <main id="app" data-result="running">
      <h1>Mail frame probe${CONTROL ? ' (control: protection OFF)' : ''}</h1>
      <p id="status">Running ${probes.length} probes, about ${Math.ceil((probes.length * PAUSE_MS) / 1000)} seconds. Do not close this page.</p>
      <table id="table"></table>
      <div id="frames"></div>
    </main>
    <script type="module" src="/probe.js"></script>
  </body>
</html>
`;
const pageCss = `body{font:14px/1.4 system-ui,sans-serif;margin:16px}table{border-collapse:collapse}td{border:1px solid #ccc;padding:2px 8px}
tr[data-result=fail]{background:#fde8e8}tr[data-result=pass]{background:#e8f7ec}tr[data-result=manual]{background:#fff6dd}
#frames{display:flex;flex-wrap:wrap;gap:8px;margin-top:16px}figure{margin:0}iframe{width:240px;height:120px;border:1px solid #999}`;

const pageServer = createServer(async (request, response) => {
  const { pathname } = new URL(request.url ?? '/', 'http://127.0.0.1');
  const send = (status, type, body) =>
    response.writeHead(status, { ...headers, 'content-type': type, 'cache-control': 'no-store' }).end(body);
  try {
    switch (`${request.method} ${pathname}`) {
      case 'GET /': {
        send(200, 'text/html; charset=utf-8', pageHtml);
        break;
      }
      case 'GET /probe.js': {
        send(200, 'text/javascript; charset=utf-8', pageScript);
        break;
      }
      case 'GET /probe.css': {
        send(200, 'text/css; charset=utf-8', pageCss);
        break;
      }
      case 'GET /config.json': {
        send(200, 'application/json', pageConfig());
        break;
      }
      case 'GET /probes.json': {
        const list = probes.map((item) => ({
          id: item.id,
          html: item.html((rest) => `${TRACKER}/p/${item.id}/${rest}`, item.id),
          click: item.click === true
        }));
        send(200, 'application/json', JSON.stringify(list));
        break;
      }
      case 'POST /report': {
        const report = JSON.parse(await readBody(request));
        if (state.report !== null) {
          // The first report is the run: a second window of the page (or a reload) cannot replace it.
          send(200, 'application/json', JSON.stringify(table()));
          break;
        }
        state.report = {
          engine: typeof report.engine === 'string' ? report.engine : 'unknown',
          shapes: report.shapes ?? {},
          exec: Array.isArray(report.exec) ? report.exec.filter((item) => typeof item === 'string') : [],
          checks: Array.isArray(report.checks)
            ? report.checks.map((check) => ({ id: String(check.id), ok: check.ok === true, detail: String(check.detail ?? '') }))
            : []
        };
        // From now on a connection comes from a click of a person (the icon of a followed link), not from a probe.
        state.current = '';
        const answer = table();
        send(200, 'application/json', JSON.stringify(answer));
        print(answer);
        if (WAIT) {
          setTimeout(() => process.exit(answer.overall === 'pass' ? 0 : 1), 300);
        }
        break;
      }
      case 'GET /result.json': {
        send(200, 'application/json', JSON.stringify(table()));
        break;
      }
      default: {
        if (request.method === 'POST' && pathname.startsWith('/mark/') && byId.has(pathname.slice(6))) {
          // Once the page has reported, no probe is current any more: a second window of the page must not take connections away from the clicks.
          if (state.report === null) {
            state.current = pathname.slice(6);
          }
          send(204, 'text/plain', '');
        } else if (request.method === 'POST' && pathname.startsWith('/clicked/') && byId.get(pathname.slice(9))?.click === true) {
          state.clicked.add(pathname.slice(9));
          send(200, 'application/json', JSON.stringify(table()));
        } else {
          send(404, 'text/plain', 'not found');
        }
      }
    }
  } catch {
    send(400, 'text/plain', 'bad request');
  }
});

function listen(server, port) {
  return new Promise((resolve, reject) => {
    server.once('error', (error) => {
      reject(
        new Error(
          `Cannot listen on 127.0.0.1:${port} (${error.code ?? error.message}). Another run may be going: pick other ports with --port= and --tracker-port=.`
        )
      );
    });
    server.listen(port, '127.0.0.1', resolve);
  });
}
try {
  await listen(trackerServer, TRACKER_PORT);
  await listen(pageServer, PAGE_PORT);
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exit(2);
}
process.stdout.write(`Mail frame probe${CONTROL ? ' (control, protection OFF)' : ''}: open http://127.0.0.1:${PAGE_PORT}/ in a browser.\n`);
process.stdout.write(
  `The fake tracker listens on ${TRACKER}; ${probes.length} probes, about ${Math.ceil((probes.length * PAUSE_MS) / 1000)} seconds.\n`
);
if (WAIT) {
  setTimeout(() => {
    process.stdout.write(`No page reported within ${WAIT_SECONDS} seconds.\n`);
    process.exit(2);
  }, WAIT_SECONDS * 1000);
}
