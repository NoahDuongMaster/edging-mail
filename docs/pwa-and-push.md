# Realtime, Web Push and PWA

- [Realtime](#realtime)
- [Web Push](#web-push)
- [Public site and the app URL](#public-site-and-the-app-url)
- [Install as an app (PWA)](#install-as-an-app-pwa)
- [Troubleshooting](#troubleshooting)

## Realtime

A signed-in browser opens a WebSocket to `GET /api/ws`. The Worker forwards it to the Durable Object `MailHub` (binding `MAIL_HUB`) **of that person**: there is one
`MailHub` per person (`idFromName('user:<id>')`), so an event can only ever reach its owner's tabs. It uses the hibernatable WebSocket API: idle connections cost
nothing, and the text `ping` is answered with `pong` without waking the object. The server sends `{"type":"hello"}` on connect, then one JSON event per change:

- `mail.new` `{ type, id, folder, from_name, from_address, created_at }`: mail arrived for this person (inbound, or sent to them by another person here). It carries
  no subject and no snippet: the browser fetches the mail by `id` and opens it with the person's key.
- `mail.changed` `{ type }`: a mail was sent, a draft saved or deleted, a batch or label action changed mail, or snoozed mail returned.

Broadcasting is best effort: a failure is logged and never fails the request that caused it. The client reconnects with exponential backoff (1 s up to 30 s) and
refetches its lists when it reconnects and when the tab becomes visible again.

The WebSocket handshake is checked like any other request: it needs the session cookie, and its `Origin` must be the app's own origin (see
[Security](security.md#cross-site-requests)).

## Web Push

Installed PWAs get a system notification when mail arrives, even with the app closed. The Worker encrypts each notification for the subscribed browser (RFC 8291
`aes128gcm`) and signs the request with a VAPID key (RFC 8292) that the Worker creates by itself. The push service (Google, Apple, Mozilla, Microsoft) only relays ciphertext,
and the ciphertext holds no part of the mail. The notification contains:

| Field   | Content                                                                    |
| ------- | -------------------------------------------------------------------------- |
| `title` | sender name, or the address when there is none (max 100 chars)             |
| `body`  | always empty: no subject and no snippet leave the server in a notification |
| `tag`   | the message id (one notification per mail)                                 |
| `url`   | `/app?m=<message id>`: tapping it opens that mail                          |

Only inbox mail notifies, and only the person it was delivered to: each person's devices are their own. The push is sent in the background after the handler has
returned, so a slow push service never delays or fails inbound mail; errors are logged. Delivery uses `TTL: 86400` and `Urgency: high`, times out after 8 seconds
and never follows a redirect (a `3xx` counts as a failed delivery). A subscription the push service reports as gone (`404`/`410`) is deleted automatically, and at
most 20 devices are kept per person (the oldest is dropped).

Snoozed mail that comes back also notifies its owner: one notification each for up to 3 returned mails, plus a summary ("N snoozed messages are back") when more returned at once.

### Set it up

1. Nothing to generate or configure. The Worker creates its VAPID key pair the first time push is needed and keeps it in D1, with the private half sealed
   under `DATA_KEY` ([Configuration → Web Push keys](configuration.md#web-push-keys)). A copy of the database alone cannot sign pushes. Existing installs only
   need the migrations (`0004_push_keys` adds the table).
2. Deploy, open the app on each device and turn notifications on in **Settings → Notifications**. Send a test notification from there.

Push needs a secure context (https, or `localhost` in development). It also needs a usable `DATA_KEY`, which this version needs anyway: without it
`GET /api/push/public-key`, `subscribe` and `test` answer `503 Push is not configured` and nothing is sent. Changing `DATA_KEY` to a key that cannot open the stored pair
(and without `DATA_KEY_PREVIOUS`) replaces the key pair and removes every device, so turn notifications on again on each device; they show as off after the reset.
A rotation that keeps the old key in `DATA_KEY_PREVIOUS` leaves the pair readable.

- **iPhone and iPad:** Safari only allows Web Push for a web app that was added to the Home Screen (Share → Add to Home Screen), on iOS or iPadOS 16.4 or later. Open
  the installed app and enable notifications from there; in a normal Safari tab the option is unavailable.
- **Endpoints:** the API only accepts `https` URLs of a browser push service (`fcm.googleapis.com`, `updates.push.services.mozilla.com` or another
  `*.push.services.mozilla.com`, `*.push.apple.com`, `*.notify.windows.com`), so a stolen session cannot register a server of its own, and only on port 443. A loopback address over `http` or `https` (a fake push service in development) is accepted only
  when the deployment says it is local (`ALLOW_LOCAL_PUSH=on` in `.dev.vars`).
- **API:** see [Web Push](api.md#web-push) in the API reference.

## Public site and the app URL

The Worker answers a few paths itself, before the static files (`assets.run_worker_first` in `wrangler.jsonc`; the code is `src/worker/site/`):

| Path                          | Answer                                                                                                                                                                                                                      |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/`                           | The Vietnamese landing page. A visitor with a real session (checked in D1, not by a cookie being present) goes to `/app` instead: `302`, query kept, so `/?m=<id>` becomes `/app?m=<id>`                                    |
| `/en/`                        | The English landing page. It never redirects, so a signed-in reader can read it too. `/en` goes to `/en/` (`308`)                                                                                                           |
| `/zh/`                        | The Simplified Chinese landing page, same rules as `/en/`: no redirect for a signed-in reader, `/zh` goes to `/zh/` (`308`). Its sign-in buttons link to `/app?lang=zh`; `/app?lang=vi` and `/app?lang=en` on the other two |
| `/app` and `/app/*`           | The app shell (`index.html` from the static assets) with `X-Robots-Tag: noindex, nofollow`; `index.html` has `<meta name="robots" content="noindex">` as well                                                               |
| `/robots.txt`, `/sitemap.xml` | Built from the origin of the request, so they are right on any host                                                                                                                                                         |
| `/api/*`                      | The API                                                                                                                                                                                                                     |
| anything else                 | A static file (`/assets/*`, `/sw.js`, icons, `/og-image.png`...) or a plain `404`. Unknown paths are no longer the app shell (`not_found_handling` is `none`)                                                               |

An entry such as `/` in `run_worker_first` matches that path only, so it does not hide `/sw.js` or `/assets/*`; `/app/*` matches everything below `/app`. `/` has to be
listed because `index.html` is a real static file that would be served for it otherwise.

**The `LANDING_PAGE` switch.** The Worker variable `LANDING_PAGE` (`vars` in `wrangler.jsonc`, see [Configuration](configuration.md)) decides whether the public page exists.
Exactly `on` (case and spaces ignored) turns it on; unset, `off` or anything else turns it off, so a fork that forgets the variable publishes no marketing page.

| Off, the default                                                   | On                                                          |
| ------------------------------------------------------------------ | ----------------------------------------------------------- |
| `/` goes to `/app` (302) without looking at the session            | `/`, `/en/` and `/zh/` as in the table                      |
| `/en`, `/en/`, `/zh`, `/zh/` and `/sitemap.xml` answer a plain 404 | `/sitemap.xml` lists `/`, `/en/` and `/zh/` with alternates |
| `robots.txt`: `Disallow: /`, no sitemap line                       | `robots.txt` allows `/`, disallows `/app` and `/api`        |

The manifest and the service worker behave the same in both modes. The repository's `wrangler.jsonc` sets `on` (the maintainer's deployment).

**The landing page** is complete HTML that needs no JavaScript: one `h1`, an `h2` per section, canonical and `hreflang` links (vi, en, x-default), Open Graph and
Twitter card tags, and JSON-LD for the software and the site (no price, rating or review). Every absolute URL is built from the request origin.

- The words are in two plain modules, `src/worker/site/copy.vi.ts` and `copy.en.ts`; one template (`landing.ts`) and one inline stylesheet (`landing.css.ts`) draw both. To
  change the text, edit those two files only. The links to the upstream project (GitHub, deploy guide, licence) are in `links.ts`: a fork that keeps the page changes them there.
- It asks for nothing from a third party: a system font stack (it covers Vietnamese), no Google Fonts, no analytics. The CSP is set in code (`headers.ts`), because
  `public/_headers` only reaches static files, never a response the Worker builds.
- The share image is `public/og-image.png` (1200x630). Its source is `docs/assets/og-image.svg`; the command that renders it again is in the comment at the top of that file.
- `public/standalone.js` is the one script. An app installed from the home screen before `/app` existed still starts at `/`; the script sends it on to `/app` (it only runs
  on the Vietnamese page, and only in a standalone window), so a signed-out user lands on the login, not on the landing page.
- The landing pages are sent with `Vary: *`. The service worker of the previous version (see below) stores any HTML it gets for a navigation under `/`; `Cache.put()` refuses a
  response that varies on `*`, so that worker never keeps a landing page as its app shell.
- Tests: `test/site/` (`npm test`) covers the routing in both modes, the session callback, the SEO tags, the lengths and the headers.

## Install as an app (PWA)

A web app manifest (`public/manifest.webmanifest`, `id` `/`, `start_url` `/app`) and a service worker (`public/sw.js`) let you install Edging Mail:

- Chrome and Edge: **Install** in the address bar.
- Android Chrome: **Install app**.
- iPhone and iPad Safari: Share → **Add to Home Screen**.

Tested in Chromium and Firefox; the cryptography known-answer tests also run in a WebKit engine (WPE); not yet verified on real Safari or iPhone.

What the service worker does:

- It caches only the app shell (page, scripts, icons), so the installed app still opens offline. The shell is stored under `/app`. Mail and every `/api` response are never cached.
- It answers navigations to `/app`, `/app/*` and `/` only. Navigation is network first, with the cached shell as the fallback after 4 seconds or when offline. A redirect (`/` to
  `/app` for a signed-in user) is handed to the browser untouched.
- Only the app itself is kept as the shell: a response is stored when it is a successful, non-redirected HTML page that contains the app's `#root`. The landing pages, a captive
  portal page and an error page are never stored. The English and Chinese landing pages (`/en/`, `/zh/`), `robots.txt` and 404s are not the worker's business, so they need the network.
- A new deploy takes over by itself the next time the app is brought to the front.
- While the app is in front, a new-mail notification is silent and goes away after a few seconds. It is not skipped, because iOS revokes the subscription of a site
  that receives a push without showing a notification.
- A notification opens `/app` (or `/app?m=<id>`). Links in a payload that point at `/` (the Worker sends `/?m=<id>`) are turned into `/app`.
- Signing out from **Settings** turns notifications off on that device first.

The service worker is registered in production builds only, so the Vite dev server (`npm run dev`) never serves a stale shell. Use `npm run build` and
`npm run worker:dev` to try the PWA locally.

`public/_headers` keeps `sw.js`, `standalone.js` and the manifest revalidated on every load and serves the hashed `/assets/*` files as immutable. Its content security policy
says `connect-src 'self'`, which also allows the app's WebSocket to this host (`wss://` on https, `ws://` on an http page such as `wrangler dev`): CSP Level 3 defines
it that way, and Chrome 71+, Firefox and Safari 16+ implement it. Safari before 16 does not, and refuses the WebSocket ("Refused to connect to wss://...") so live updates
need Safari 16 or later (installed apps with notifications need iOS 16.4 anyway).

### Upgrading from the previous service worker

The previous version cached the shell under `/` in `edging-mail-v2` and, network first with a 4 second timeout, stored every HTML answer for a navigation under `/`. The cache
is now `edging-mail-v3` and the shell key is `/app`. A browser that still runs the old worker reaches the new login within one reload, whatever its state:

1. **Online, signed in** (a browser tab or an app installed with start URL `/`). The old worker is network first, so the new Worker's answer wins at once: `/` gives `302 /app`,
   the old worker passes the redirect on, `/app` is the new shell, and the old worker stores it under `/` (a real shell, so that is harmless). The new bundle registers
   `/sw.js`; its bytes differ, so the new worker installs (it caches `/app`), calls `skipWaiting()`, and on activation deletes `edging-mail-v2` and claims the open pages.
2. **Online, signed out.** `/`, `/en/` or `/zh/` is a landing page with `Vary: *`; the old worker tries to store it as the shell, `Cache.put()` rejects, and the old worker ignores
   the error, so its cached shell stays a real one. **Sign in** goes to `/app` (new shell, same steps as 1). An installed app opening `/` gets `standalone.js`, which replaces the
   page with `/app` straight away (the landing page may show for an instant).
3. **Offline or slow during the switch.** Until the new worker is active, the old one answers `/` and `/app` from its cached shell (the previous version of the app, which shows its
   own "No connection" text); after the switch the new worker answers both with the new shell. Without `Vary: *` the landing page would have replaced the cached shell and
   offline `/app` would show the landing page, whose Sign in goes to `/app` again: a dead end. That is the case the header prevents.
4. **A browser that never opens the app** (only the landing page) gets the new worker when the browser itself checks `/sw.js` (browsers do that on a navigation, roughly once a day); nothing depends on it.

The worker has no migration code on purpose: it only needs the old one to be network first, which it was.

## Troubleshooting

| Symptom                                          | Check                                                                                                                                                                                                                   |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Push is not configured"                         | `DATA_KEY` is missing or unusable. Set it, see [Configuration](configuration.md#data_key); there is no separate Web Push setting                                                                                        |
| Notifications stopped after a `DATA_KEY` change  | The key was changed without `DATA_KEY_PREVIOUS`, so the push key was replaced and every device removed. Turn notifications off and on again on each device                                                              |
| No notifications on iPhone                       | Add the app to the Home Screen first and enable notifications from the installed app                                                                                                                                    |
| Live updates do not arrive                       | Check the WebSocket in the browser's network tab: `101` on `/api/ws`. A `403` means the `Origin` did not match; a `401` means signed out                                                                                |
| A device keeps getting notifications after theft | Sign out in the app on a device you still have (it ends every session of the account), change the password, then run `DELETE FROM push_subscriptions` on the remote D1 (see [Security](security.md#if-something-leaks)) |
| `/` shows the landing page, not the app          | By design without a session. A signed-in browser goes to `/app`; with `LANDING_PAGE` not `on`, `/` always goes to `/app`                                                                                                |
| `/en/` or `/zh/` answers 404, `/` goes to `/app` | `LANDING_PAGE` is not exactly `on` (unset, `off` and a typo all mean off): see [Public site and the app URL](#public-site-and-the-app-url)                                                                              |
| An installed app opens the landing page          | Installed before `/app` existed (start URL `/`). Check that `/standalone.js` loads; installing the app again gives start URL `/app`                                                                                     |
