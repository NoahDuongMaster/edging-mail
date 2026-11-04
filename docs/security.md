# Security

Edging Mail holds private mail, so the defaults fail closed. This page describes what the code does and where its limits are.

- [Reporting a vulnerability](#reporting-a-vulnerability)
- [Threat model](#threat-model)
- [Login and sessions](#login-and-sessions)
- [Brute-force protection](#brute-force-protection)
- [Cross-site requests](#cross-site-requests)
- [Mail content](#mail-content)
- [Response headers](#response-headers)
- [Push notifications](#push-notifications)
- [Secrets and logs](#secrets-and-logs)
- [If something leaks](#if-something-leaks)
- [Known limitations](#known-limitations)

## Reporting a vulnerability

Please report security problems privately. On the repository page open the **Security** tab and use **Report a vulnerability** (GitHub private vulnerability
reporting). Do not open a public issue for something exploitable. Include what you found, how to reproduce it, and the version or commit you tested.

## Threat model

Edging Mail is built for one owner who runs their own deployment.

- **Protected:** the mailbox contents (D1 rows, R2 objects), settings, and the ability to send mail as you. Only someone with the password (or a live session
  cookie) can reach them.
- **Not protected against:** Cloudflare itself and anyone with access to your Cloudflare account, who can read D1 and R2 directly. Mail is stored as received
  and is not end-to-end encrypted. Mail in transit between mail servers is as protected as those servers make it.
- **Untrusted input:** every inbound message (headers, HTML, attachments, file names) is treated as hostile.
- **Push key:** the Web Push private key sits in D1 sealed under a key derived from `JWT_SECRET`, so a database export alone cannot sign pushes.

## Login and sessions

Every `/api/*` route needs a valid session cookie. Only `GET /api/health` and `/api/auth/*` are public.

- `POST /api/auth/login` compares the password with `APP_PASSWORD` in constant time (it compares HMACs of both values with `SubtleCrypto`, so even the length
  does not leak) and sets the `edging_session` cookie: `HttpOnly`, `SameSite=Lax`, `Path=/`, `Secure` over https, valid for 14 days.
- The cookie is `<payload>.<HMAC-SHA256 signature>`. The payload holds only the issue time and the expiry. The signing key is derived from `JWT_SECRET` **and**
  `APP_PASSWORD`, so changing either one signs everybody out.
- **Fail closed:** if `APP_PASSWORD` or `JWT_SECRET` is missing or too short (`APP_PASSWORD` under 12 characters, `JWT_SECRET` under 32), login answers
  `503 Login is not configured` and every protected route stays `401`. The Worker log names which secret is too short.
- **Logout revokes.** `POST /api/auth/logout` clears the cookie and stores a `sessions_valid_after` timestamp, which invalidates every session issued before it,
  on every device. Only a signed-in caller can trigger the revocation.
- The session check reads that timestamp from D1 on each request; if D1 cannot be read the request is treated as signed out.

## Brute-force protection

Wrong passwords are throttled in D1 (`login_attempts`), per client IP (`CF-Connecting-IP`; IPv6 addresses are grouped by their /64).

| Event                                                    | Result                                                                                        |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Every wrong password                                     | Answer after a 400 ms delay                                                                   |
| 5 wrong passwords from one client within 15 minutes      | Lock for 15 minutes: `429` with `Retry-After` (the lock applies even to the correct password) |
| Every further 5 failures                                 | The lock doubles, up to 24 hours                                                              |
| A correct password                                       | Clears that client's counter                                                                  |
| More than 20 wrong passwords per hour across all clients | An extra 3 s delay on wrong-password answers (a delay, never a lockout)                       |
| The throttle table cannot be used                        | `503 Login is temporarily unavailable`: without the throttle there is no login                |

The counter is incremented in one atomic upsert before the password is compared, so parallel requests cannot all get a free guess. To clear a lock:

```bash
npx wrangler d1 execute DB --local --command "DELETE FROM login_attempts"    # --remote for production
```

Requests that arrive without a usable `CF-Connecting-IP` header share a single throttle key.

## Cross-site requests

- Browsers always send `Sec-Fetch-Site` and page scripts cannot forge it. The API answers `403` when it is anything but `same-origin` or `none`, which blocks
  cross-site and same-site (sibling subdomain) requests. Clients that send no such header (curl, Wrangler's email handler) are not affected.
- The WebSocket handshake is covered too: when an `Origin` header is present it must equal the Worker's own origin (loopback hosts talking to each other are
  accepted, for local development through the Vite proxy). This stops a page on a sibling subdomain from opening the cookie-authenticated socket.
- There are no CORS headers, and the cookie is `SameSite=Lax`.

## Mail content

Mail is untrusted, so the reader never runs it as part of the app.

- HTML mail is rendered in an `<iframe>` with `sandbox="allow-popups allow-popups-to-escape-sandbox"`: no scripts, no same-origin access, no form submission, no
  navigation of the parent page.
- The frame has its own Content-Security-Policy (`default-src 'none'`) that blocks every remote request until you press **Show images**, and then allows `https:`
  images only, so images over plain `http` never load. Remote CSS, fonts and frames stay blocked.
- Links open in a new tab with `rel="noopener noreferrer"`, `<meta http-equiv="refresh">` is removed, and the frame sets a `no-referrer` policy.
- Attachments and raw `.eml` downloads are always served as downloads: opaque `application/octet-stream` (or `message/rfc822`), `X-Content-Type-Options: nosniff`,
  `Content-Security-Policy: default-src 'none'; sandbox`, `Cache-Control: private, no-store`. File names are sanitised for the `Content-Disposition` header and for
  the R2 key.
- Nothing is scanned for malware or phishing. Treat attachments like any other download.

## Response headers

- API responses go through Hono's `secureHeaders()` defaults (among others `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`,
  `Referrer-Policy: no-referrer`, `Cross-Origin-Opener-Policy` and `Cross-Origin-Resource-Policy: same-origin`, and `Strict-Transport-Security` over https only).
  JSON answers add `Cache-Control: no-store`.
- Static files get the policy in `public/_headers`: `default-src 'self'`, `script-src 'self'`, `frame-ancestors 'none'`, `base-uri 'none'`, `object-src 'none'`,
  `form-action 'self'`, `connect-src 'self' wss:`, `img-src 'self' data: https:`, plus `X-Content-Type-Options`, `Referrer-Policy: no-referrer` and a
  `Permissions-Policy` that turns off camera, microphone and geolocation. `style-src` allows `'unsafe-inline'` (the UI sets inline styles) and Google Fonts
  (`fonts.googleapis.com`, `fonts.gstatic.com`).

## Push notifications

- A notification carries the sender and the subject (or the snippet) only, truncated to 100 and 200 characters, encrypted for the one subscribed browser. The push
  service sees ciphertext.
- Subscriptions are accepted only for the real push services (`fcm.googleapis.com`, `*.push.services.mozilla.com`, `*.push.apple.com`, `*.notify.windows.com`), so
  a stolen session cannot point notifications at a server of the thief's choosing. Redirects from a push service are never followed.
- The Web Push key pair is created by the Worker on first use. Its private half is stored in D1 (`push_keys`), sealed with AES-256-GCM under a key derived from
  `JWT_SECRET`; it is not an environment variable. See [Web Push keys](configuration.md#web-push-keys).

## Secrets and logs

- `APP_PASSWORD` and `JWT_SECRET` are Worker secrets (`wrangler secret put`) or, locally, entries in the gitignored `.dev.vars`. Never commit
  them, and never paste them into an issue or pull request.
- `.env*` and `.dev.vars` are in `.gitignore`. `.dev.vars.example` holds placeholders that are deliberately too short to log in with.
- Error answers use the plain D1 message and drop the SQL parameters (addresses, subjects, draft text). Push logs name only the push service origin. The snooze cron
  logs counts, never mail content.

## If something leaks

1. Replace `APP_PASSWORD` and `JWT_SECRET` (`npx wrangler secret put …`). Every existing session stops working at once because the signing key changes. A new
   `JWT_SECRET` also resets the push key: the next time push is needed the Worker creates a new pair and removes every registered device.
2. To remove push subscriptions right away instead of at the next push, so no device keeps receiving notifications:
   `npx wrangler d1 execute DB --remote --command "DELETE FROM push_subscriptions"`.
3. If you suspect only the push key leaked, rotating `JWT_SECRET` (step 1) is the way to reset it: there is no separate command. Afterwards turn notifications on again
   on your devices.
4. If the Cloudflare API token leaked, roll it in the Cloudflare dashboard.

## Known limitations

- One password, no second factor, no passkeys.
- Single user: there is no per-user access control, so anyone who can sign in can read, send and delete everything.
- No end-to-end encryption and no spam or virus filtering of inbound mail (everything lands in the Inbox; Spam is a folder you move mail into).
- The page loads the Geist fonts from Google Fonts (`index.html`), so the visitor's browser contacts Google when the app opens. Self-hosting the font files would remove that.
- Only the login route is throttled. Other routes rely on the session cookie and on Cloudflare's network protections.
- Outgoing authentication (SPF, DKIM, DMARC) is whatever Cloudflare Email Sending and your DNS provide; the Worker does not sign mail itself.
