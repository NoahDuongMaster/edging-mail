# Realtime, Web Push and PWA

- [Realtime](#realtime)
- [Web Push](#web-push)
- [Install as an app (PWA)](#install-as-an-app-pwa)
- [Troubleshooting](#troubleshooting)

## Realtime

A signed-in browser opens a WebSocket to `GET /api/ws`. The Worker forwards it to one Durable Object, `MailHub` (binding `MAIL_HUB`), which uses the hibernatable
WebSocket API: idle connections cost nothing, and the text `ping` is answered with `pong` without waking the object. The server sends `{"type":"hello"}` on
connect, then one JSON event per change:

- `mail.new` `{ type, id, folder, from_name, from_address, subject, snippet, created_at }`: an inbound mail was stored (message and attachment rows).
- `mail.changed` `{ type }`: a mail was sent, a draft saved or deleted, a batch or label action changed mail, or snoozed mail returned.

Broadcasting is best effort: a failure is logged and never fails the request that caused it. The client reconnects with exponential backoff (1 s up to 30 s) and
refetches its lists when it reconnects and when the tab becomes visible again.

The WebSocket handshake is checked like any other request: it needs the session cookie, and its `Origin` must be the app's own origin (see
[Security](security.md#cross-site-requests)).

## Web Push

Installed PWAs get a system notification when mail arrives, even with the app closed. The Worker encrypts each notification for the subscribed browser (RFC 8291
`aes128gcm`) and signs the request with a VAPID key (RFC 8292) that the Worker creates by itself. The push service (Google, Apple, Mozilla, Microsoft) only relays ciphertext. The notification contains:

| Field   | Content                                                           |
| ------- | ----------------------------------------------------------------- |
| `title` | sender name, or the address when there is none (max 100 chars)    |
| `body`  | subject, or the snippet when the subject is empty (max 200 chars) |
| `tag`   | the message id (one notification per mail)                        |
| `url`   | `/?m=<message id>`: tapping it opens that mail                    |

Only inbox mail notifies. The push is sent in the background after the inbound handler has returned, so a slow push service never delays or fails inbound mail;
errors are logged. Delivery uses `TTL: 86400` and `Urgency: high`, times out after 8 seconds and never follows a redirect (a `3xx` counts as a failed delivery). A
subscription the push service reports as gone (`404`/`410`) is deleted automatically, and at most 20 devices are kept (the oldest is dropped).

Snoozed mail that comes back also notifies: one notification each for up to 3 returned mails, plus a summary when more returned at once.

### Set it up

1. Nothing to generate or configure. The Worker creates its VAPID key pair the first time push is needed and keeps it in D1, with the private half sealed
   ([Configuration → Web Push keys](configuration.md#web-push-keys)). Existing installs only need the migrations (`0004_push_keys` adds the table).
2. Deploy, open the app on each device and turn notifications on in **Settings → Notifications**. Send a test notification from there.

Push needs a secure context (https, or `localhost` in development). It also needs `JWT_SECRET`, which login needs anyway: without it `GET /api/push/public-key`,
`subscribe` and `test` answer `503 Push is not configured` and nothing is sent. Changing `JWT_SECRET` replaces the key pair and removes every device, so turn
notifications on again on each device; they show as off after the reset.

- **iPhone and iPad:** Safari only allows Web Push for a web app that was added to the Home Screen (Share → Add to Home Screen), on iOS or iPadOS 16.4 or later. Open
  the installed app and enable notifications from there; in a normal Safari tab the option is unavailable.
- **Endpoints:** the API only accepts `https` URLs of a browser push service (`fcm.googleapis.com`, `updates.push.services.mozilla.com` or another
  `*.push.services.mozilla.com`, `*.push.apple.com`, `*.notify.windows.com`), so a stolen session cannot register a server of its own. Plain `http` is accepted for
  `localhost` and `127.0.0.1` only (a fake push service in development).
- **API:** see [Web Push](api.md#web-push) in the API reference.

## Install as an app (PWA)

A web app manifest (`public/manifest.webmanifest`) and a service worker (`public/sw.js`) let you install Edging Mail:

- Chrome and Edge: **Install** in the address bar.
- Android Chrome: **Install app**.
- iPhone and iPad Safari: Share → **Add to Home Screen**.

What the service worker does:

- It caches only the app shell (page, scripts, icons), so the installed app still opens offline. Mail and every `/api` response are never cached.
- Navigation is network first, with the cached shell as the fallback after 4 seconds or when offline.
- A new deploy takes over by itself the next time the app is brought to the front.
- While the app is in front, a new-mail notification is silent and goes away after a few seconds. It is not skipped, because iOS revokes the subscription of a site
  that receives a push without showing a notification.
- Signing out from **Settings** turns notifications off on that device first.

The service worker is registered in production builds only, so the Vite dev server (`npm run dev`) never serves a stale shell. Use `npm run build` and
`npm run worker:dev` to try the PWA locally.

`public/_headers` keeps `sw.js` and the manifest revalidated on every load and serves the hashed `/assets/*` files as immutable.

## Troubleshooting

| Symptom                                          | Check                                                                                                                                               |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Push is not configured"                         | `JWT_SECRET` is missing. Set it, see [Configuration](configuration.md#variables-and-secrets); there is no separate Web Push setting                 |
| Notifications stopped after `JWT_SECRET` change  | The push key was replaced and every device removed. Turn notifications off and on again on each device (they show as off after the reset)           |
| No notifications on iPhone                       | Add the app to the Home Screen first and enable notifications from the installed app                                                                |
| Live updates do not arrive                       | Check the WebSocket in the browser's network tab: `101` on `/api/ws`. A `403` means the `Origin` did not match; a `401` means signed out            |
| A device keeps getting notifications after theft | Rotate `APP_PASSWORD` and `JWT_SECRET`, then run `DELETE FROM push_subscriptions` on the remote D1 (see [Security](security.md#if-something-leaks)) |
