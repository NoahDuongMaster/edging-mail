/* global document, DOMParser, addEventListener */
// The part of the mail frame probe that runs in the browser (scripts/frame-probe.mjs bundles it with esbuild, together with the app's own
// src/client/lib/mailDocument.ts). It puts each probe through buildMailDocument into a sandboxed srcdoc iframe, one after the other, then reports to the
// server, which holds the fake tracker and decides the verdicts. It may use only what a browser has.
import { buildMailDocument } from '../src/client/lib/mailDocument.ts';

function pause(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function getJson(address) {
  const response = await fetch(address);
  return response.json();
}

/** A poll that failed is tried again by the timer: nothing to do. */
function ignored() {
  // The server is not answering for the moment.
}

/** The table of verdicts the server sent, on the page: a `data-result` on the page and on every row. */
function show(answer) {
  const app = document.querySelector('#app');
  app.dataset.result = answer.overall;
  document.title = `${answer.overall.toUpperCase()}: mail frame probe`;
  document.querySelector('#status').textContent = answer.summary;
  document.querySelector('#table').replaceChildren(
    ...answer.rows.map((row) => {
      const line = document.createElement('tr');
      line.dataset.result = row.result;
      line.dataset.probe = row.id;
      if (row.note === true) {
        line.dataset.note = 'true';
      }
      for (const text of [row.id, row.result, row.detail]) {
        const cell = document.createElement('td');
        cell.textContent = text;
        line.append(cell);
      }
      return line;
    })
  );
}

// What the built document names, counted here with code of its own (a browser's URL parser, not the app's functions), so that a mistake of the app's
// functions does not hide itself: every address of another host in an attribute (but the target of a link and the words a person reads), every
// srcset and sizes, every remote url(), @import and image-set string of a style, and speculation rules.
const TEXT_ATTRIBUTES = new Set(['alt', 'title', 'placeholder', 'value', 'label', 'summary', 'aria-label']);

function namesHost(value) {
  try {
    const { host } = new URL(value, 'https://nowhere.invalid/');
    return host !== '' && host !== 'nowhere.invalid';
  } catch {
    return false;
  }
}

function remoteInCss(text) {
  let count = 0;
  for (const match of text.matchAll(/url\(\s*(["']?)(.*?)\1\s*\)/gi)) {
    count += namesHost(match[2]) ? 1 : 0;
  }
  count += /@import/i.test(text) ? 1 : 0;
  count += /image-set\([^)]*["']\s*(?:https?:)?\/\//i.test(text) ? 1 : 0;
  return count;
}

function remoteIn(parsed) {
  let count = parsed.querySelectorAll('script[type="speculationrules" i]').length;
  for (const element of parsed.querySelectorAll('*')) {
    const followed = element.localName === 'a' || element.localName === 'area';
    for (const attribute of element.attributes) {
      const name = attribute.name.toLowerCase();
      if (name === 'srcset' || name === 'sizes') {
        count += 1;
      } else if (name === 'style') {
        count += remoteInCss(attribute.value);
      } else if (!TEXT_ATTRIBUTES.has(name) && !(followed && name === 'href') && namesHost(attribute.value)) {
        count += 1;
      }
    }
  }
  for (const style of parsed.querySelectorAll('style')) {
    count += remoteInCss(style.textContent);
  }
  return count;
}

/** What the document of a probe looks like, apart from what a browser does with it (PX-3). */
function shapeOf(srcDoc) {
  const parsed = new DOMParser().parseFromString(srcDoc, 'text/html');
  const first = parsed.head.firstElementChild;
  return {
    links: parsed.querySelectorAll('link').length,
    baseWithHref: parsed.querySelectorAll('base[href]').length,
    pings: parsed.querySelectorAll('[ping]').length,
    remote: remoteIn(parsed),
    speculation: parsed.querySelectorAll('script[type="speculationrules" i]').length,
    refresh: parsed.querySelectorAll('meta[http-equiv="refresh" i]').length,
    dnsFirst: first?.getAttribute('http-equiv') === 'x-dns-prefetch-control' && first.getAttribute('content') === 'off',
    dnsOn: parsed.querySelectorAll('meta[http-equiv="x-dns-prefetch-control" i][content="on" i]').length
  };
}

// A mail with every kind of picture, built with images ALLOWED and with images off: what the reader chose to see is kept, and the reader is told it is there.
function checksOfTheDocument() {
  const mail =
    '<img src="https://img.example/a.png" srcset="https://img.example/a.png 1x, https://img.example/b.png 2x" sizes="100px">' +
    '<picture><source srcset="https://img.example/c.png"><img></picture>' +
    '<div style="background:url(https://img.example/d.png)">x</div><style>p{background:url(//img.example/e.png)}</style><a href="https://link.example/">x</a>';
  const on = buildMailDocument(mail, '#4f46e5', true, new Map());
  const off = buildMailDocument(mail, '#4f46e5', false, new Map());
  const kept = new DOMParser().parseFromString(on.srcDoc, 'text/html');
  const lost = [
    ['img src', kept.querySelector('img[src="https://img.example/a.png"]')],
    ['img srcset', kept.querySelector('img[srcset*="b.png 2x"]')],
    ['img sizes', kept.querySelector('img[sizes="100px"]')],
    ['source srcset', kept.querySelector('source[srcset="https://img.example/c.png"]')],
    ['style attribute', kept.querySelector('div[style*="img.example/d.png"]')],
    ['style element', [...kept.querySelectorAll('style')].find((style) => style.textContent.includes('img.example/e.png'))]
  ]
    .filter(([, found]) => !found)
    .map(([name]) => name);
  const link = new DOMParser().parseFromString(off.srcDoc, 'text/html').querySelector('a[href="https://link.example/"]');
  const policy = new DOMParser().parseFromString(on.srcDoc, 'text/html').querySelector('meta[http-equiv="Content-Security-Policy"]');
  return [
    {
      id: 'images-on-keeps',
      ok: lost.length === 0,
      detail:
        lost.length === 0 ? 'with images allowed every picture address is kept' : `with images allowed these were lost: ${lost.join(', ')}`
    },
    {
      id: 'images-off-flags',
      ok: off.hasRemoteImages === true && on.hasRemoteImages === true,
      detail: 'the reader is told that the mail has pictures (hasRemoteImages)'
    },
    { id: 'images-off-keeps-link', ok: link !== null, detail: 'the target of a link is kept while images are off' },
    {
      id: 'images-on-policy',
      ok: policy?.getAttribute('content')?.includes('img-src data: https:') === true,
      detail: 'images allowed: the policy lets data: and https: pictures through'
    }
  ];
}

/** A click made later by a person or a driver shows up here; `suffix` is added to the summary. */
function refreshLater(suffix = '') {
  setInterval(() => {
    getJson('/result.json')
      .then((answer) => {
        show({ ...answer, summary: answer.summary + suffix });
      })
      .catch(ignored);
  }, 2000);
}

/** The engine that runs this page, from its user agent: the control run needs it to know which canaries the engine acts on. WebKit browsers on iOS are WebKit whatever their name. */
function engineOfThisBrowser() {
  const agent = navigator.userAgent;
  if (/Firefox\//.test(agent)) {
    return 'firefox';
  }
  if (/Chrome\/|Chromium\//.test(agent)) {
    return 'chromium';
  }
  return /AppleWebKit\//.test(agent) ? 'webkit' : 'unknown';
}

async function main() {
  const config = await getJson('/config.json');
  // A driver (or a person) that clicked the link of a click probe says so; the server then lets the probe pass if nothing leaked.
  globalThis.__probeClicked = async (id) => {
    const answer = await fetch(`/clicked/${encodeURIComponent(id)}`, { method: 'POST' });
    if (answer.ok) {
      show(await answer.json());
    }
    return answer.ok;
  };
  if (config.reported) {
    // A second window of this page (a reload, a link that opened it): the probes ran once and the server holds that run. Show it, run nothing.
    const note = ' This window ran no probe: they ran once, in the first window of this run.';
    const answer = await getJson('/result.json');
    show({ ...answer, summary: answer.summary + note });
    refreshLater(note);
    return;
  }
  const probes = await getJson('/probes.json');
  const exec = [];
  addEventListener('message', (event) => {
    if (typeof event.data === 'string' && event.data.startsWith('exec:')) {
      exec.push(event.data);
    }
  });
  const shapes = {};
  const grid = document.querySelector('#frames');
  for (const item of probes) {
    await fetch(`/mark/${item.id}`, { method: 'POST' });
    // With the protection off (--control) the frame gets the raw mail: the probe must then see leaks.
    const srcDoc = config.control ? item.html : buildMailDocument(item.html, '#4f46e5', false, new Map()).srcDoc;
    shapes[item.id] = shapeOf(srcDoc);
    const cell = document.createElement('figure');
    cell.dataset.probe = item.id;
    const caption = document.createElement('figcaption');
    caption.textContent = item.click ? `${item.id}: click the link` : item.id;
    const frame = document.createElement('iframe');
    // The attributes are set before the frame is in the page, the way React does it for MailFrame.
    frame.title = item.id;
    frame.setAttribute('sandbox', config.sandbox);
    frame.srcdoc = srcDoc;
    cell.append(caption, frame);
    if (item.click) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = 'I clicked the link';
      button.dataset.clicked = item.id;
      button.addEventListener('click', () => {
        globalThis.__probeClicked(item.id).catch(ignored);
      });
      cell.append(button);
    }
    grid.append(cell);
    await pause(config.pause);
  }
  await pause(config.pause);
  const posted = await fetch('/report', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ shapes, exec, checks: checksOfTheDocument(), engine: engineOfThisBrowser() })
  });
  show(await posted.json());
  refreshLater();
}

await main();
