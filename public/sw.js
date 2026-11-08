// Edging Mail service worker. Plain JS, no build step.
// 1. Keeps the app shell so the installed app opens offline. Mail and every other /api response is never stored.
// 2. Shows Web Push notifications (sender + subject only) and opens the mail when one is tapped.

// Bump to drop everything cached by older versions of this file.
const CACHE = 'edging-mail-v3';
// The app lives at /app. "/" is the public landing page or a redirect to /app, so it is never the shell and never stored.
const SHELL = '/app';
const NAVIGATION_TIMEOUT_MS = 4000;
// A notification that appears while the app is in front is dismissed after this long.
const QUIET_DISMISS_MS = 5000;
const NOT_CACHED = /^\/(api|cdn-cgi)(\/|$)/;
// The navigations this worker answers: the app, and "/" (the start URL of apps installed before /app existed, now a
// redirect to /app or the landing page). Every other page (the English landing page, robots.txt, a 404) is the network's.
const APP_NAVIGATION = /^\/(app(\/.*)?)?$/;

self.addEventListener('install', (event) => {
  // A failed precache (offline install) must not block the update: the shell is cached on the next visit.
  event.waitUntil(
    precacheShell()
      .catch(() => undefined)
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((name) => name !== CACHE).map((name) => caches.delete(name)));
      await self.clients.claim();
    })()
  );
});

// Hashed files are cached when they are a plain successful answer; an HTML body here is a fallback page for a missing file.
function isCacheable(response) {
  return response.ok && response.type === 'basic' && !response.headers.get('Content-Type')?.startsWith('text/html');
}

const isHtml = (response) => response.ok && !response.redirected && response.headers.get('Content-Type')?.startsWith('text/html');

// Only the app itself is the shell: the landing page, a redirect target, a captive portal or an error page are HTML too.
const isAppShell = (html) => /\bid=["']?root\b/.test(html);

const assetsIn = (html) => [...new Set(html.match(/\/assets\/[^"'\s)]+/g) ?? [])];

// Stores the shell and the hashed files it loads, and forgets assets of earlier builds.
async function storeShell(response) {
  const html = await response.clone().text();
  if (!isAppShell(html)) {
    return;
  }
  const cache = await caches.open(CACHE);
  const used = assetsIn(html);
  await cache.put(SHELL, response);
  await Promise.all(
    used.map(async (path) => {
      if (!(await cache.match(path))) {
        const asset = await fetch(path);
        if (isCacheable(asset)) {
          await cache.put(path, asset);
        }
      }
    })
  );
  for (const request of await cache.keys()) {
    const { pathname } = new URL(request.url);
    if (pathname.startsWith('/assets/') && !used.includes(pathname)) {
      await cache.delete(request);
    }
  }
}

async function precacheShell() {
  const response = await fetch(SHELL, { cache: 'reload' });
  if (isHtml(response)) {
    await storeShell(response);
  }
}

// Network first so a deploy shows up at once; the cached shell answers when the network is down or slow. A redirect
// ("/" -> "/app" for a signed-in user) is handed to the browser untouched, and the landing page is never stored.
async function navigate(event) {
  const network = fetch(event.request).then((response) => {
    if (isHtml(response)) {
      event.waitUntil(storeShell(response.clone()).catch(() => undefined));
    }
    return response;
  });
  event.waitUntil(network.catch(() => undefined));
  const timeout = new Promise((_, reject) => setTimeout(reject, NAVIGATION_TIMEOUT_MS));
  try {
    return await Promise.race([network, timeout]);
  } catch {
    return (await caches.match(SHELL)) ?? network;
  }
}

// Hashed build files and the app icons: bump CACHE when an icon changes.
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) {
    return cached;
  }
  const response = await fetch(request);
  if (isCacheable(response)) {
    const cache = await caches.open(CACHE);
    await cache.put(request, response.clone());
  }
  return response;
}

async function staleWhileRevalidate(event) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(event.request);
  const refresh = fetch(event.request).then(async (response) => {
    if (isCacheable(response)) {
      await cache.put(event.request, response.clone());
    }
    return response;
  });
  if (cached) {
    event.waitUntil(refresh.catch(() => undefined));
    return cached;
  }
  return refresh;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || NOT_CACHED.test(url.pathname)) {
    return;
  }
  if (request.mode === 'navigate') {
    if (APP_NAVIGATION.test(url.pathname)) {
      event.respondWith(navigate(event));
    }
  } else if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/')) {
    event.respondWith(cacheFirst(request));
  } else {
    event.respondWith(staleWhileRevalidate(event));
  }
});

// A same-origin path (with query) inside the app, or '/app' for anything else. "/" is not the app any more (it is the
// landing page or a redirect), and push payloads sent by an older Worker still carry "/" and "/?m=<id>".
function appPath(value) {
  try {
    const url = new URL(value, self.location.origin);
    if (url.origin !== self.location.origin) {
      return SHELL;
    }
    return (url.pathname === '/' ? SHELL : url.pathname) + url.search + url.hash;
  } catch {
    return SHELL;
  }
}

function readPayload(event) {
  let data = null;
  try {
    data = event.data ? event.data.json() : null;
  } catch {
    // not JSON: use the generic text below
  }
  const text = (value) => (typeof value === 'string' ? value : '');
  const fields = data !== null && typeof data === 'object' ? data : {};
  return {
    // The product name is the same in every language, so a push payload without a title still reads right.
    title: text(fields.title) || 'Edging Mail',
    body: text(fields.body),
    tag: text(fields.tag) || 'mail',
    url: appPath(text(fields.url))
  };
}

async function showMail(event) {
  const { title, body, tag, url } = readPayload(event);
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const inFront = tag !== 'test' && windows.some((client) => client.visibilityState === 'visible' && client.focused);
  // iOS Safari revokes the push subscription of a site that receives pushes without showing a notification, so the
  // app being in front can only make the notification quiet and short-lived, never skip it.
  await self.registration.showNotification(title, {
    body,
    tag,
    icon: '/icons/icon-192.png',
    badge: '/icons/badge.png',
    data: { url },
    silent: inFront,
    renotify: !inFront
  });
  if (inFront) {
    await new Promise((resolve) => setTimeout(resolve, QUIET_DISMISS_MS));
    for (const notification of await self.registration.getNotifications({ tag })) {
      notification.close();
    }
  }
}

self.addEventListener('push', (event) => {
  event.waitUntil(showMail(event));
});

async function openApp(path) {
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  // Most recently focused first.
  const client = windows.find((candidate) => new URL(candidate.url).origin === self.location.origin);
  if (client) {
    await client.focus().catch(() => undefined);
    const current = new URL(client.url);
    try {
      if (current.pathname + current.search !== path) {
        await client.navigate(path);
      }
      return;
    } catch {
      // A window this worker does not control cannot be navigated: open a new one instead.
    }
  }
  await self.clients.openWindow(path);
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(openApp(appPath(event.notification.data?.url)));
});
