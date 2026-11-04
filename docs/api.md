# HTTP API reference

The Worker serves a JSON API under `/api`. The React app is its only intended client, but the API is plain HTTP and can be scripted. Everything here is
read from `src/worker/index.ts`, `auth.ts`, `drafts.ts`, `push.ts` and `realtime.ts`.

- [Conventions](#conventions)
- [Authentication](#authentication) · [Health](#health)
- [Mail](#mail): [stats](#get-apistats), [list](#get-apimessages), [read one](#get-apimessagesid), [batch](#post-apimessagesbatch),
  [mark all read](#post-apimessagesread-all), [labels](#labels), [send](#post-apimessagessend), [downloads](#downloads)
- [Drafts](#drafts) · [Settings](#settings) · [Web Push](#web-push) · [Realtime](#realtime-websocket)

## Conventions

- Bodies are JSON (`Content-Type: application/json`). Timestamps are epoch milliseconds, except where noted.
- Every JSON answer has `success: boolean`. A failure is `{ "success": false, "error": "<reason>" }` with a 4xx/5xx status. Exceptions: `GET /api/health`
  has no `success` field, and the two download routes answer errors as plain text.
- JSON answers carry `Cache-Control: no-store`.
- **Auth:** every route needs the `edging_session` cookie, except `GET /api/health` and `/api/auth/*`. Without a valid cookie the answer is
  `401 { "success": false, "error": "Unauthorized" }`. Unknown `/api/*` paths are `401` too when you are signed out.
- **Same origin only:** browsers send `Sec-Fetch-Site`; any value other than `same-origin` or `none` is refused with `403 { "error": "Forbidden" }`. Clients that
  send no such header (curl, scripts) are accepted. There are no CORS headers, so other websites cannot call the API from a browser.
- A body that is not a JSON object is `400` ("A JSON object body is required" on the mail routes). `500` carries the plain D1 error message, never the SQL
  parameters.
- Examples use `curl` with a cookie jar: `-c jar -b jar`.

```bash
curl -s -c jar -H 'Content-Type: application/json' -d '{"password":"…"}' http://localhost:8787/api/auth/login
curl -s -b jar http://localhost:8787/api/stats
```

## Authentication

| Route                   | Auth   | Purpose                                    |
| ----------------------- | ------ | ------------------------------------------ |
| `POST /api/auth/login`  | public | Exchange the password for a session cookie |
| `POST /api/auth/logout` | public | Clear the cookie and revoke older sessions |
| `GET /api/auth/session` | public | Tell whether the cookie is valid           |

### `POST /api/auth/login`

Body: `{ "password": "<APP_PASSWORD>" }`.

| Status | Body                                                                                                       | When                                                                                  |
| ------ | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| 200    | `{ "success": true }` + `Set-Cookie`                                                                       | Password matches                                                                      |
| 401    | `{ "success": false, "error": "Wrong password" }`                                                          | Wrong or missing password, after a 400 ms delay (3.4 s while the app is under attack) |
| 429    | `{ "success": false, "error": "Too many attempts. Try again later.", "retry_after": <s> }` + `Retry-After` | The client IP is locked, see [security](security.md#brute-force-protection)           |
| 503    | `{ "success": false, "error": "Login is not configured" }`                                                 | `APP_PASSWORD`/`JWT_SECRET` missing or too short                                      |
| 503    | `{ "success": false, "error": "Login is temporarily unavailable" }`                                        | The attempt counter in D1 could not be read or written                                |

The cookie is `edging_session=<payload>.<signature>; HttpOnly; SameSite=Lax; Path=/; Max-Age=1209600` (14 days), plus `Secure` when the request URL is
`https`.

### `POST /api/auth/logout`

Always clears the cookie. When the caller holds a valid session it also stores the current time as `sessions_valid_after`, which revokes every session issued
before it. An anonymous caller revokes nothing. Answers `{ "success": true }`, or `500 "Could not sign out on the server"` if the revocation could not be
stored.

### `GET /api/auth/session`

Always `200 { "success": true, "authenticated": true | false }`.

## Health

`GET /api/health` (public): `{ "status": "ok", "app": "<APP_NAME>", "edge": "Cloudflare Workers", "timestamp": <ms> }`.

## Mail

Row shapes used below:

- **Message** (a row of `messages`): `id`, `message_id`, `thread_id`, `from_address`, `from_name`, `to_address`, `cc`, `bcc`, `reply_to`, `subject`, `snippet`,
  `body_text`, `body_html`, `r2_key`, `folder`, `labels` (a JSON array stored as text), `is_read` (0/1), `is_starred` (0/1), `has_attachments` (0/1), `size`,
  `created_at`, `updated_at`, `references_header`, `in_reply_to`, `snoozed_until`.
- **Attachment** (a row of `attachments`): `id`, `message_id`, `filename`, `mime_type`, `size`, `r2_key`, `content_id`, `is_inline` (0/1), `created_at`.
- **Folders:** `inbox`, `sent`, `drafts`, `snoozed`, `archive`, `spam`, `trash`. `starred` is a view (mail with `is_starred = 1` that is not in `trash`).

### `GET /api/stats`

`{ "success": true, "stats": { "inbox": { "total": n, "unread": n }, "sent": …, "starred": …, "archive": …, "spam": …, "trash": …, "drafts": …, "snoozed": … } }`.
`drafts.unread` is always `0`.

### `GET /api/messages`

| Query    | Default | Meaning                                                                                                                                          |
| -------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `folder` | `inbox` | A folder, `starred`, or `label:<name>` (mail carrying that label, outside `trash` and `spam`)                                                    |
| `q`      | none    | Search text, trimmed and cut to 200 characters; matches subject, sender, recipients and snippet, ASCII case-insensitive, `%` `_` `\` are literal |
| `page`   | 1       | 1-based, capped at 100000; a non-numeric value takes the default                                                                                 |
| `limit`  | 30      | 1 to 100                                                                                                                                         |

Answer: `{ "success": true, "messages": [Message…], "page": n, "limit": n }`. Order: newest `created_at` first (equal dates: later arrival first). `drafts`:
most recently saved first. `snoozed`: the one due soonest first. An unknown folder name gives an empty list.

### `GET /api/messages/:id`

Returns `{ "success": true, "message": Message, "attachments": [Attachment…] }` and marks the mail read. `?peek=1` skips the mark-read (used for background
refreshes). `404 "Message not found"`.

### `POST /api/messages/batch`

Body: `{ "action": "<action>", "message_ids": ["…"], "folder"?: "…", "until"?: <epoch ms> }`. Answer: `{ "success": true, "count": n }`.

| `action`            | Effect                                                                         |
| ------------------- | ------------------------------------------------------------------------------ |
| `read` / `unread`   | Set `is_read`                                                                  |
| `star` / `unstar`   | Set `is_starred`                                                               |
| `trash` / `archive` | Move to that folder (clears `snoozed_until`)                                   |
| `restore`           | Move to `inbox` (clears `snoozed_until`)                                       |
| `move`              | Move to `folder`: one of `inbox`, `archive`, `trash`, `spam`, `sent`, `drafts` |
| `snooze`            | Move to `snoozed` until `until`; drafts and Sent mail are left alone           |
| `delete`            | Delete the rows, their attachment rows and the R2 objects (permanent)          |

`count` is the number of ids sent, except for `snooze`, where it is the number of mails actually snoozed.

| Status | `error`                                              | When                                                            |
| ------ | ---------------------------------------------------- | --------------------------------------------------------------- |
| 400    | `A JSON object body is required`                     | Body is not a JSON object                                       |
| 400    | `message_ids array is required`                      | Missing, not an array, or empty                                 |
| 400    | `Valid folder is required for move`                  | `folder` missing or not in the list above                       |
| 400    | `Use the snooze action to snooze mail`               | `move` with `folder: "snoozed"`                                 |
| 400    | `until must be between 1 minute and 1 year from now` | `until` is not an integer from now + 1 minute to now + 366 days |
| 400    | `Invalid action`                                     | Unknown `action`                                                |

D1 allows 100 bound parameters per statement and each id is one, so send at most 100 ids per call.

### `POST /api/messages/read-all`

Body: `{ "folder"?: "inbox", "q"?: "…" }`. Marks every unread mail of that folder view as read, with the same folder, label and search rules as the list, also
beyond the pages a client has loaded. Answer: `{ "success": true, "count": n }` (mails changed).

### Labels

- `GET /api/labels` → `{ "success": true, "labels": ["…"] }`: the distinct label names in use by mail outside `trash` and `spam`, sorted.
- `POST /api/messages/labels` with `{ "id": "<message id>", "labels": ["…"] }` replaces the labels of a mail and answers `{ "success": true, "labels": […] }`.
  Names are trimmed and de-duplicated ignoring case (first spelling wins). The call does not check that the id exists.

| Status | `error`                                                    | When                                      |
| ------ | ---------------------------------------------------------- | ----------------------------------------- |
| 400    | `id and labels[] are required`                             | Missing `id`, or `labels` is not an array |
| 400    | `At most 20 labels per message`                            | More than 20 after de-duplication         |
| 400    | `Labels must be 1-30 letters, numbers, spaces, "_" or "-"` | A name outside `^[\p{L}\p{N} _-]{1,30}$`  |

### `POST /api/messages/send`

Sends a mail through Cloudflare Email Sending and stores it in Sent. See [Mail features](mail-features.md#sending) for the behaviour behind it.

| Field          | Type               | Notes                                                                                                        |
| -------------- | ------------------ | ------------------------------------------------------------------------------------------------------------ |
| `to`           | string or string[] | Required, at least one address                                                                               |
| `subject`      | string             | Required (empty is refused)                                                                                  |
| `from`         | string             | Optional bare address; falls back to the saved `default_from`, then the `DEFAULT_FROM` var                   |
| `cc`, `bcc`    | string or string[] | Optional                                                                                                     |
| `reply_to`     | string             | Optional bare address                                                                                        |
| `text`, `html` | string             | Body parts; send either or both                                                                              |
| `in_reply_to`  | string             | `Message-ID` of the mail you answer, in angle brackets, at most 998 bytes                                    |
| `references`   | string[]           | Used as the chain only when the answered mail is not stored                                                  |
| `attachments`  | array              | `{ "filename", "content_base64", "content_type" }`, at most 32                                               |
| `draft_id`     | string             | Lowercase UUID of the draft the mail was written in; deleted after a successful send (only if it is a draft) |

Success: `200 { "success": true, "message": Message, "note": "Accepted by Cloudflare Email Service" }`.

| Status | `error` (start of the text)                                                           | When                                                                     |
| ------ | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| 400    | `A JSON object body is required`, `to and subject are required`                       | Malformed or incomplete request                                          |
| 400    | `No sender address configured`                                                        | No `from`, no saved default, no `DEFAULT_FROM`                           |
| 400    | `Invalid email address: …`                                                            | An address (sender, to, cc, bcc, reply_to) is not a bare `name@host.tld` |
| 400    | `in_reply_to and references must be Message-IDs in angle brackets`                    | Bad `in_reply_to` or `references` entry                                  |
| 400    | `draft_id must be a UUID`, `At least one recipient is required`                       | Bad `draft_id`; empty `to`                                               |
| 400    | `Subject, sender name and attachment filenames or types must not contain line breaks` | Header injection guard                                                   |
| 400    | `At most 32 attachments are allowed`, `The message is larger than 25 MiB`             | Size limits (approximate: counts base64 characters)                      |
| 400    | `Attachment <name> is not valid base64`, `Invalid message: …`                         | Undecodable attachment; the MIME builder refused the message             |
| 502    | `Email sending is not configured: the SEND_EMAIL binding is missing`                  | No `send_email` binding                                                  |
| 502    | `Email delivery failed: <reason> [<code>]`                                            | Cloudflare refused the message; nothing is stored                        |
| 500    | `The email was sent but could not be saved to Sent: …`                                | The mail is out but the Sent row failed; do not send it again            |

### Downloads

| Route                      | Content-Type               | Notes                                                                                                |
| -------------------------- | -------------------------- | ---------------------------------------------------------------------------------------------------- |
| `GET /api/attachments/:id` | `application/octet-stream` | Always an attachment download; `404 Attachment not found` / `Attachment file not found in storage`   |
| `GET /api/raw/:id`         | `message/rfc822`           | The stored `.eml` as `email-<id>.eml`; `404 Raw email not found` / `EML object not found in storage` |

Both add `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'; sandbox` and `Cache-Control: private, no-store`. Errors are plain text.

## Drafts

A draft is a `messages` row in the `drafts` folder. `:id` is a lowercase UUID made by the client (`crypto.randomUUID()`), so the first save and every later save are
the same call.

| Route                    | Answer                                                                                                                                                   |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PUT /api/drafts/:id`    | Create or update. Body: `{ from?, to?, cc?, bcc?, subject?, text?, html?, in_reply_to? }` (missing means empty). `{ "success": true, "id", "saved_at" }` |
| `GET /api/drafts/:id`    | `{ "success": true, "draft": { id, from, to[], cc[], bcc[], subject, text, html, in_reply_to? } }`                                                       |
| `DELETE /api/drafts/:id` | `{ "success": true }`                                                                                                                                    |

`GET` and `DELETE` only see drafts: any other id is `404 "Draft not found"`. A `PUT` never overwrites a real mail: `409 "This id belongs to a message that is not a draft"`.
Recipient addresses are not syntax-checked (a draft may be unfinished); sending validates them. A draft that answers a mail joins that mail's thread.

| Limit                                                                  | Status |
| ---------------------------------------------------------------------- | ------ |
| request body over 4 MiB (by `Content-Length`)                          | 413    |
| `html` over 200 000 characters, `text` over 100 000                    | 413    |
| `to`, `cc`, `bcc` over 100 items each; one address over 320 characters | 400    |
| `from` over 320 characters                                             | 400    |
| `subject` over 500 characters or with a line break                     | 400    |
| `in_reply_to` not `<id@host>`, or over 998 characters                  | 400    |
| `:id` is not a lowercase UUID (`PUT` only)                             | 400    |

## Settings

`GET /api/settings` → `{ "success": true, "settings": { "display_name": "", "signature": "", "default_from": "…" } }`, with defaults filled in (`default_from` falls
back to the `DEFAULT_FROM` var, then to an empty string).

`POST /api/settings` takes a partial object of those three keys and answers `{ "success": true, "settings": <effective values> }`. Each key is upserted.

| Key            | Rule                                                         |
| -------------- | ------------------------------------------------------------ |
| `display_name` | String, trimmed, one line, at most 100 characters            |
| `signature`    | String, kept as typed, at most 2000 characters               |
| `default_from` | A bare email address, or `""` to fall back to `DEFAULT_FROM` |

Errors are `400` with: `Body must be an object of settings`, `Unknown setting: <key>`, `<key> must be a string`, or the rule that failed.

## Web Push

All routes are behind the login cookie. Push needs `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT`; without them `public-key`, `subscribe` and
`test` answer `503 "Push is not configured"`. Bodies are limited to 4096 characters (`413`).

| Route                        | Body                                           | Answer                                                               |
| ---------------------------- | ---------------------------------------------- | -------------------------------------------------------------------- |
| `GET /api/push/public-key`   |                                                | `{ "success": true, "publicKey": "…" }`                              |
| `POST /api/push/subscribe`   | `{ "endpoint", "keys": { "p256dh", "auth" } }` | `{ "success": true }`; upserts by endpoint and stores the User-Agent |
| `POST /api/push/unsubscribe` | `{ "endpoint" }`                               | `{ "success": true }` (also when it was not subscribed)              |
| `POST /api/push/status`      | `{ "endpoint" }`                               | `{ "success": true, "subscribed": true \| false }`                   |
| `POST /api/push/test`        |                                                | `{ "success": true, "sent": n, "failed": n, "removed": n }`          |

`subscribe` validation (all `400`): `endpoint` is required, at most 2048 characters, a valid URL, without credentials, and `https` on a known push service
(`fcm.googleapis.com`, `updates.push.services.mozilla.com` or another `*.push.services.mozilla.com`, `*.push.apple.com`, `*.notify.windows.com`); plain `http`
is accepted for `localhost` and `127.0.0.1` only. `keys.p256dh` must decode to 65 bytes and be a valid P-256 point, `keys.auth` to 16 bytes. The newest 20
subscriptions are kept. See [Realtime, Web Push and PWA](pwa-and-push.md) for the delivery details.

## Realtime (WebSocket)

`GET /api/ws` with `Upgrade: websocket`. A request without the upgrade header is `426 { "success": false, "error": "Expected a WebSocket upgrade request" }`. The
`Origin` header must equal the Worker's own origin (two loopback hosts, as in local development, are also accepted), otherwise `403`.

On connect the server sends `{"type":"hello"}`. Send the text `ping` to get `pong`. Events:

```json
{ "type": "mail.new", "id": "…", "folder": "inbox", "from_name": "…", "from_address": "…", "subject": "…", "snippet": "…", "created_at": 0 }
{ "type": "mail.changed" }
```

`mail.new` is sent when an inbound mail is stored. `mail.changed` follows a send, a draft save or delete, a batch action, a label change, "mark all as read" and
a snoozed mail returning to the inbox. Broadcasting is best effort and never fails the request that caused it.
