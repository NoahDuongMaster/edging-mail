# ⚡ edging-mail

> **100% Serverless Edge Webmail running entirely on Cloudflare Workers, D1, R2, and Email Routing.**
> _Zero servers. Zero cold starts. Zero dollars to get started._

![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)
![Platform: Cloudflare Workers](https://img.shields.io/badge/Platform-Cloudflare%20Workers-orange.svg)
![Storage: Cloudflare D1 & R2](https://img.shields.io/badge/Storage-D1%20%26%20R2-orange.svg)

---

## ✨ Features

- **100% Edge Powered**: Runs entirely inside Cloudflare Workers compute and edge infrastructure.
- **Cloudflare Email Routing Native**: Ingests incoming emails via the native `email()` Worker event binding without any third-party mail server.
- **RFC 822 MIME Parser**: Fast, edge-compatible MIME parsing via `postal-mime` (extracts plain text, HTML, and attachments).
- **D1 SQLite Database**: High-speed indexing for messages, threads, folders (`inbox`, `sent`, `drafts`, `starred`, `snoozed`, `archive`, `trash`, `spam`), and search.
- **R2 Blob Storage**: Stores raw `.eml` files and all attachments with zero egress fees.
- **Outbound Email**: Sends through Cloudflare Email Service (the `send_email` Workers binding) with your own display name, signature and sender address, and proper `In-Reply-To`/`References` threading for replies. A failed send is reported as a failure, never saved as sent.
- **Modern React + Tailwind UI**: Fast SPA built with React 19, Tailwind CSS v4, Lucide icons, dark mode, keyboard-friendly UI, and live attachment downloads.
- **Private by Default**: Single-user password login; every API route except `/api/health` and `/api/auth/*` needs the signed session cookie.

---

## 🏗️ Architecture

```
               [ Inbound Email (SMTP) ]
                          │
                          ▼
            [ Cloudflare Email Routing ]
                          │
                          ▼ (Worker email() hook)
               ┌──────────────────────┐
               │   edging-mail Core   │
               │ (Cloudflare Worker)  │
               └──────────┬───────────┘
                          │
         ┌────────────────┴────────────────┐
         ▼                                 ▼
  [ Cloudflare D1 ]                 [ Cloudflare R2 ]
   Messages, Threads,                Raw .eml files,
   Folders, Metadata                 Attachments
         ▲                                 ▲
         └────────────────┬────────────────┘
                          │ (REST API & Assets)
                          ▼
               [ React Edge Webmail UI ]
```

---

## 🚀 Quick Start

### 1. Clone & Install Dependencies

```bash
git clone https://github.com/your-username/edging-mail.git
cd edging-mail
npm install
```

### 2. Set Up Local Cloudflare D1 & R2

Apply the D1 migrations locally (details in "Database & Migrations" below):

```bash
npm run db:migrate:local
```

### 3. Build & Run Locally

To build the client SPA and start the Worker with local D1 and R2 emulation:

```bash
# Build client assets
npm run build

# Start Cloudflare Worker dev server (the login needs these two values, see "Login & Secrets" below)
npm run worker:dev -- --var APP_PASSWORD:"a-long-random-password" --var JWT_SECRET:"$(openssl rand -hex 32)"
```

Open `http://localhost:8787` in your browser and sign in with that password. (`wrangler.jsonc` has `dev.host` set to `localhost`: without it `wrangler dev` tells the Worker its URL is `mail.duongnamtruong.com`, taken from `routes`, and the WebSocket Origin check then refuses the Vite dev server.)

### 4. Receive a Real Email Locally

There is no mock inbox: mail enters through the same `email()` handler Cloudflare Email Routing calls in production. `wrangler dev` exposes it at `/cdn-cgi/handler/email`; post a real MIME message to it (this endpoint is not an `/api` route, so no login is needed locally):

```bash
cat > hello.eml <<'EOF'
From: Alice <alice@example.org>
To: hi@yourdomain.com
Subject: Hello from a real MIME message
Message-ID: <hello-1@example.org>
Content-Type: text/plain; charset=utf-8

Hi! This goes through the same parser and storage as production mail.
EOF

curl -X POST "http://localhost:8787/cdn-cgi/handler/email?from=alice@example.org&to=hi@yourdomain.com" --data-binary @hello.eml
```

The mail shows up in the Inbox. Build the `.eml` with whatever you like (HTML part, attachments, `In-Reply-To` to test threading, non-ASCII subjects): the parser sees it exactly as it would from Email Routing. Its `In-Reply-To` and `References` are stored, and its `Date` header becomes the mail's date unless that is missing, invalid or in the future (see "Lists, Threads & Stats").

---

## 🗄️ Database & Migrations

The D1 schema is defined with [Drizzle ORM](https://orm.drizzle.team) in `src/worker/db/schema.ts`. SQL migrations live in `drizzle/` and are applied by Wrangler (`migrations_dir` in `wrangler.jsonc`), which records what it has run in the database's `d1_migrations` table.

| Command                     | What it does                                                                         |
| --------------------------- | ------------------------------------------------------------------------------------ |
| `npm run db:migrate:local`  | `wrangler d1 migrations apply DB --local` – apply pending migrations to the local D1 |
| `npm run db:migrate:remote` | `wrangler d1 migrations apply DB --remote` – same for the production D1              |
| `npm run db:generate`       | `drizzle-kit generate` – write a new migration from the changes in `schema.ts`       |

**Changing the schema:** edit `src/worker/db/schema.ts`, run `npm run db:generate`, review the new `drizzle/NNNN_*.sql`, then `npm run db:migrate:local` and later `npm run db:migrate:remote`. Commit the whole `drizzle/` folder, including `drizzle/meta/` – `drizzle-kit` diffs against it.

Applying migrations is safe to repeat: Wrangler skips the ones already applied. The baseline `drizzle/0000_init.sql` is hand-edited (`CREATE ... IF NOT EXISTS`, `INSERT OR IGNORE` for the default settings), so it is also a no-op on a database that was created earlier from the old `schema.sql` (removed; the migrations replace it). Don't regenerate it.

### Legacy databases

A database created from the very first version of `schema.sql` has no `messages.labels` column. For such a database `db:migrate:*` stops with `no such column: labels` (nothing is recorded). Add the column once, then run the migration again:

```bash
npx wrangler d1 execute DB --local --command "ALTER TABLE messages ADD COLUMN labels TEXT NOT NULL DEFAULT '[]'"   # --remote for production
npm run db:migrate:local                                                                                           # or db:migrate:remote
```

If the column already exists, the `ALTER` fails with `duplicate column name: labels`, which is harmless.

---

## 🔐 Login & Secrets

edging-mail is a single-user app. Every `/api/*` route (messages, settings, attachments, raw downloads, push, WebSocket) answers `401` without a valid session cookie; only `/api/health` and `/api/auth/*` are public.

- `POST /api/auth/login` with `{ "password": "…" }` compares the password with `APP_PASSWORD` in constant time and sets an `HttpOnly`, `SameSite=Lax` cookie (`Secure` over https), valid for 14 days. A wrong password gets `401` after a short delay. `POST /api/auth/logout` clears the cookie **and revokes every session issued before it**, `GET /api/auth/session` tells whether you are signed in.
- The cookie is `<payload>.<HMAC-SHA256 signature>`; the key is derived from `JWT_SECRET` **and** `APP_PASSWORD`, so changing either one signs everybody out.
- It fails closed: if `APP_PASSWORD` or `JWT_SECRET` is missing, or too short (`APP_PASSWORD` under 12 characters, `JWT_SECRET` under 32), login answers `503 Login is not configured` and every protected route stays `401`. The worker log names which secret is too short.
- Cross-site requests are refused: the API answers `403` when the browser reports `Sec-Fetch-Site` other than `same-origin`/`none` (this also covers the WebSocket handshake). There are no CORS headers.
- **Brute-force protection:** each client IP (IPv6 grouped by /64) gets 5 wrong passwords, then login answers `429` with `Retry-After` for 15 minutes; every further 5 failures double the lock, up to 24 hours. More than 20 failures per hour across all IPs adds a 3 s delay to wrong-password answers (a delay, never a lockout). To clear a lock: `npx wrangler d1 execute DB --local --command "DELETE FROM login_attempts"` (`--remote` in production).

| Name           | Kind   | Purpose                                                                   |
| -------------- | ------ | ------------------------------------------------------------------------- |
| `APP_PASSWORD` | secret | The password you type on the login screen, at least 12 characters, random |
| `JWT_SECRET`   | secret | Random key that signs the session cookie, at least 32 characters          |
| `DEFAULT_FROM` | var    | Sender address used until you save one in Settings (`wrangler.jsonc`)     |

Generate strong values with `openssl rand -base64 24` (password) and `openssl rand -hex 32` (`JWT_SECRET`). After a suspected compromise, rotate both secrets and run `DELETE FROM push_subscriptions` so no device keeps receiving notifications.

Never commit the two secrets.

```bash
# Local: copy the template once, edit the values, then run the dev server as usual
cp .dev.vars.example .dev.vars        # gitignored; replace the placeholders
npm run worker:dev
# (or pass them on the command line instead of a file)
npm run worker:dev -- --var APP_PASSWORD:"a-long-random-password" --var JWT_SECRET:"$(openssl rand -hex 32)"

# Production: store them as Worker secrets (prompted, never written to the repo)
npx wrangler secret put APP_PASSWORD
npx wrangler secret put JWT_SECRET
```

---

## ✉️ Sending Email & Settings

**Sender identity.** Open **Settings** in the app to set your display name, signature and default sender address (stored in D1). A message is sent from, in this order: the `from` of the request, the saved default address, the `DEFAULT_FROM` var (`wrangler.jsonc`); if none is set the send is rejected with `No sender address configured`. The display name appears in the `From` header (`"Your Name" <you@yourdomain.com>`). `GET /api/settings` returns the effective values; `POST /api/settings` accepts `display_name` (≤ 100 characters), `signature` (≤ 2000) and `default_from` (an email address, or empty to fall back to `DEFAULT_FROM`) and rejects anything else.

**Delivery.** Mail goes out through [Cloudflare Email Service](https://developers.cloudflare.com/email-service/) using the `send_email` binding (`SEND_EMAIL` in `wrangler.jsonc`) and its structured `send()` API: Cloudflare builds the MIME message, adds the `Date`, `Message-ID` and DKIM signature, and returns the `Message-ID`, which is stored with the sent mail so a reply from the recipient lands in the same thread. Replying sets `In-Reply-To` and `References`. If the binding is missing or Cloudflare refuses the message, `POST /api/messages/send` answers `502` with the reason and nothing is saved in Sent. A request that is invalid on its face is rejected with `400` before anything is built or sent: an address that contains a comma, quote or whitespace, a line break in the subject, sender name, `reply_to` or an attachment's name or type, an attachment that is not valid base64, more than 32 attachments, a `draft_id` that is not a lowercase UUID, an `in_reply_to` or `references` entry that is not a `<…>` Message-ID of at most 998 bytes, or more than 25 MiB. The archive copy of the mail (`.eml` in R2) is built before delivery, so a problem with it can never surface after the mail is out; if the mail is delivered but saving the Sent copy then fails, the answer is `500` with `The email was sent but could not be saved to Sent`: the mail is out, do not send it again.

**Replies, attachments and drafts.** A reply (`in_reply_to` = the Message-ID of the mail you answer) sends `In-Reply-To` and a `References` header made of the answered mail's own stored chain plus its Message-ID, oldest first and without duplicates; if that mail is not stored, the `references` list of the request stands in for its chain. When the chain would not fit in 2048 bytes, the oldest ids are dropped, except the first (the thread root) and the last (the mail you answer). The same value is stored on the Sent row (`references_header`, `in_reply_to`) and in its archive copy, and the reply joins the answered mail's thread. The attachments of a sent mail are stored like inbound ones (R2 `attachments/<message id>/…` plus `attachments` rows), so Sent lists them and `GET /api/attachments/:id` serves them. The optional `draft_id` is the id of the draft the mail was written in: once the mail is delivered and stored in Sent, that row is deleted if, and only if, it is in the `drafts` folder; any other id is ignored, and a failed send keeps the draft.

Requirements for real delivery (Email Sending is in beta):

1. Your domain uses Cloudflare DNS and is onboarded under **Compute &rarr; Email Service &rarr; Email Sending &rarr; Onboard Domain**. Cloudflare adds MX, SPF and DKIM records on the `cf-bounce` subdomain and a DMARC record on `_dmarc.<your domain>`; propagation usually takes 5-15 minutes. A domain can carry only one DMARC record and one SPF record per name: see "Production Deployment" for a domain whose mail is hosted elsewhere.
2. The sender address must belong to an onboarded domain (otherwise `E_SENDER_NOT_VERIFIED` / `E_SENDER_DOMAIN_NOT_AVAILABLE`).
3. Before a domain is onboarded you can only send to verified destination addresses of your account (Email Routing &rarr; Destination addresses). Once it is, any recipient works (arbitrary recipients need the Workers Paid plan).
4. Limits: 50 recipients (to + cc + bcc) per message, 25 MiB per message including attachments, 32 attachments, and a daily quota that starts low on new accounts.

**Locally**, `wrangler dev` only simulates the binding: the message is logged (`send_email binding called with MessageBuilder`), its text/HTML/attachments are written under `.wrangler/tmp/email/`, and nothing leaves your machine. The headers (`In-Reply-To`, `References`) and the attachment list of each simulated send are readable at `http://localhost:8787/cdn-cgi/explorer/api/local/email/sending`. Add `"remote": true` to the `send_email` entry to send real mail from `wrangler dev` (use test recipients).

---

## 🗂️ Lists, Threads & Stats

- **Order.** `GET /api/messages?folder=…` returns the newest mail first by its date (`created_at`). Mails with exactly the same date keep their arrival order (the later arrival first), so paging never skips or repeats a mail. The date of an inbound mail is its `Date` header, but a missing or unparsable `Date`, or one more than 5 minutes in the future, is replaced by the arrival time, so a wrong clock cannot pin a mail to the top. Two folders sort differently: `drafts` shows the most recently saved first, `snoozed` the one that returns soonest first.
- **Threads.** Every stored mail keeps its `In-Reply-To` and `References` headers (`in_reply_to`, `references_header`; a `References` chain longer than 4000 characters is cut after its last complete id). A mail that answers a stored mail joins that mail's thread (`thread_id`), including when it answers one of your own sent replies.
- **Stats.** `GET /api/stats` answers `{ success, stats: { inbox, sent, starred, archive, spam, trash, drafts, snoozed } }`, each `{ total, unread }`; a draft is never unread, so `drafts.unread` is always `0`.
- **Search.** `GET /api/messages?q=…` finds the text in the subject, sender, recipients and snippet of the folder being listed, ignoring upper/lower case for ASCII letters; `%`, `_` and `\` are ordinary characters. The text is cut to 200 characters. The test is `instr()`, not `LIKE`, because D1 refuses `LIKE` patterns over 50 bytes (a long search would be an HTTP 500); the label filter (`folder=label:<name>`) uses the same test, so a 30-character CJK label (90 bytes) works.
- **Opening a mail.** `GET /api/messages/:id` marks the mail read. `GET /api/messages/:id?peek=1` returns the same JSON without marking it: the client uses it to refresh a mail that is already open, so a mail the cron has just woken stays unread until it is really opened.
- **Batch actions.** `count` in the answer is the number of ids sent, except for `snooze`, where it is the number of mails really snoozed. `snooze` leaves drafts and Sent mail alone, and `move` to `snoozed` is refused with `400` (use `snooze`). Whatever takes a mail out of Snoozed (move, restore, archive, trash) clears its `snoozed_until`.
- **Mark all as read.** `POST /api/messages/read-all` with `{ "folder": "inbox", "q": "…" }` (`q` optional) marks every unread mail of that folder view as read, also the ones beyond the pages the client has loaded, using the same folder, label and search rules as the list. The answer is `{ success, count }`, the number of mails changed.

---

## 🔔 Realtime & Web Push

**Realtime.** A signed-in browser opens a WebSocket to `GET /api/ws`. The Worker forwards it to one Durable Object, `MailHub` (binding `MAIL_HUB`), which uses the hibernatable WebSocket API: idle connections cost nothing, and the text `ping` is answered with `pong` without waking the object. The server sends `{"type":"hello"}` on connect, then one JSON event per change:

- `mail.new` `{ type, id, folder, from_name, from_address, subject, snippet, created_at }`: an inbound mail was stored (message and attachment rows).
- `mail.changed` `{ type }`: a mail was sent, or a batch/label action changed mail.

Broadcasting is best-effort: a failure is logged and never fails the request that caused it.

**Web Push.** Installed PWAs get a system notification when mail arrives, even with the app closed. The Worker encrypts each notification for the subscribed browser (RFC 8291 `aes128gcm`) and signs the request with your VAPID key (RFC 8292); the push service (Google, Apple, Mozilla) only relays ciphertext. The notification contains:

| Field   | Content                                                           |
| ------- | ----------------------------------------------------------------- |
| `title` | sender name, or the address when there is none (max 100 chars)    |
| `body`  | subject, or the snippet when the subject is empty (max 200 chars) |
| `tag`   | the message id (one notification per mail)                        |
| `url`   | `/?m=<message id>`: tapping it opens that mail                    |

Only inbox mail notifies. The push is sent in the background after the inbound handler has returned, so a slow push service never delays or fails inbound mail; errors are logged. A subscription the push service reports as gone (`404`/`410`) is deleted automatically, and at most 20 devices are kept (the oldest is dropped). A redirect (`3xx`) from a push service counts as a failed delivery and is never followed.

### VAPID keys

Generate a key pair once:

```bash
node -e "const k=require('node:crypto').generateKeyPairSync('ec',{namedCurve:'P-256'}).privateKey.export({format:'jwk'});const b=(s)=>Buffer.from(s,'base64url');console.log('VAPID_PUBLIC_KEY='+Buffer.concat([Buffer.from([4]),b(k.x),b(k.y)]).toString('base64url'));console.log('VAPID_PRIVATE_KEY='+k.d)"
```

| Name                | Kind   | Value                                                                              |
| ------------------- | ------ | ---------------------------------------------------------------------------------- |
| `VAPID_PUBLIC_KEY`  | var    | the printed public key; add it under `vars` in `wrangler.jsonc`                    |
| `VAPID_SUBJECT`     | var    | `mailto:you@yourdomain.com` (or an `https://` URL); add it under `vars` as well    |
| `VAPID_PRIVATE_KEY` | secret | the printed private key: `npx wrangler secret put VAPID_PRIVATE_KEY`, never commit |

Locally, pass them with `--var VAPID_PUBLIC_KEY:… --var VAPID_PRIVATE_KEY:… --var VAPID_SUBJECT:mailto:…` (like the login secrets). If one of the three is missing, push is off: `GET /api/push/public-key` answers `503 Push is not configured`, nothing is sent, and mail and realtime keep working. Changing the key pair invalidates existing subscriptions: turn notifications off and on again on each device.

### Using it

- Turn notifications on in **Settings → Notifications** on each device and send a test notification from there. Push needs a secure context (https, or `localhost` in development).
- **iPhone/iPad:** Safari only allows Web Push for a web app that was added to the Home Screen (Share → Add to Home Screen), on iOS/iPadOS 16.4 or later. Open the installed app and enable notifications from there; in a normal Safari tab the option is unavailable.
- API (all behind the login cookie): `GET /api/push/public-key`, `POST /api/push/subscribe` `{ endpoint, keys: { p256dh, auth } }`, `POST /api/push/unsubscribe` `{ endpoint }`, `POST /api/push/status` `{ endpoint }`, `POST /api/push/test` (answers `{ sent, failed, removed }`). Endpoints must be `https` URLs of a browser push service (`fcm.googleapis.com`, `updates.push.services.mozilla.com` or another `*.push.services.mozilla.com`, `*.push.apple.com`, `*.notify.windows.com`), so a stolen session cannot register a server of its own; plain `http` is accepted only for `localhost`/`127.0.0.1` (a fake push service in development).

### Install as an app (PWA)

A web app manifest and a service worker (`public/sw.js`) let you install Edging Mail: Chrome/Edge → **Install** in the address bar, Android Chrome → **Install app**, iPhone/iPad Safari → Share → **Add to Home Screen**. The service worker caches only the app shell (page, scripts, icons), so the installed app still opens offline; mail and every `/api` response are never cached. A new deploy takes over by itself the next time the app is brought to the front. While the app is in front, a new-mail notification is silent and goes away after a few seconds (iOS revokes the subscription of a site that skips a notification). Signing out turns notifications off on that device.

---

## ✍️ Drafts & Snooze

### Drafts

A draft is an ordinary row in the `drafts` folder. While you write, the compose window saves it by itself about 1.5 seconds after your last change (header text: `Saving…` / `Draft saved`); close it and the draft stays in **Drafts**, click it to continue. Sending removes the draft, but only after the mail was really delivered and stored in Sent: a failed send keeps it. Drafts are never unread and never notify.

- **Attachments are not saved** in drafts (the compose window says so when you attach a file). Re-attach them after reopening a draft.
- A draft that answers a mail remembers it (`in_reply_to`), so the reply lands in the same thread when it is sent.
- API (behind the login cookie): `PUT /api/drafts/:id` creates or updates, `GET /api/drafts/:id` reads one back, `DELETE /api/drafts/:id` discards it, and `POST /api/messages/send` accepts an optional `draft_id` to delete the draft after a successful send. `:id` is a UUID made by the browser (`crypto.randomUUID()`), so the first save and every later save are the same call. `PUT` takes the whole compose state `{ from?, to?, cc?, bcc?, subject?, text?, html?, in_reply_to? }` (a missing field is saved as empty) and answers `{ success, id, saved_at }`. The list `GET /api/messages?folder=drafts` shows the most recently saved draft first.
- A `PUT` never overwrites a real mail: if the id already belongs to a message in any other folder the answer is `409`. `GET` and `DELETE` only see drafts (`404` for anything else).

| Limit                                                  | Answer when exceeded |
| ------------------------------------------------------ | -------------------- |
| `html` ≤ 200 000 characters                            | `413`                |
| `text` ≤ 100 000 characters                            | `413`                |
| request body ≤ 4 MiB                                   | `413`                |
| `to`, `cc`, `bcc` ≤ 100 items each                     | `400`                |
| one address ≤ 320 characters                           | `400`                |
| `subject` ≤ 500 characters, one line                   | `400`                |
| `in_reply_to` looks like `<id@host>`, ≤ 998 characters | `400`                |
| `:id` is a lowercase UUID                              | `400`                |

Recipient addresses are not checked for syntax (a draft may be unfinished); sending validates them.

### Snooze

Snoozing hides a mail until a chosen time, then brings it back. `POST /api/messages/batch` with `{ "action": "snooze", "message_ids": [...], "until": <epoch ms> }` moves the mails to the `snoozed` folder; `until` must be between 1 minute and 366 days from now. The **Snoozed** folder lists the soonest first. Moving a snoozed mail anywhere else (archive, trash, restore…) cancels its snooze.

A Cron Trigger (`triggers.crons = ["* * * * *"]` in `wrangler.jsonc`, every minute) runs the Worker's `scheduled()` handler, which does one atomic `UPDATE … RETURNING` on every snoozed mail whose time has come. Those mails:

- return to the **Inbox, unread**, with the **original date** they had: a mail comes back in place and is not moved to the top of the list;
- are announced once: open tabs get a single `mail.changed` event, and installed devices get a Web Push notification for each of up to 3 returned mails (sender, subject; tapping it opens the mail), plus one summary notification (`N snoozed messages are back`) when more than 3 returned at once.

Because the release is a single statement, two cron runs that overlap cannot release or notify about the same mail twice. A mail is back at the first run after its time, so at most about a minute late. If a run fails (logged without any mail content) nothing is lost: the mail stays snoozed and the next minute retries. Push and realtime are best effort and never block the release.

**Plan note.** Cron Triggers are available on the Workers Free plan (5 per account; this app uses 1), and `wrangler deploy` registers the schedule. If you would rather have fewer runs, change the expression (for example `*/5 * * * *`); snoozed mail then returns up to that much later.

**Test the cron path locally.** Start the dev server with `--test-scheduled`, then call Wrangler's scheduled endpoint:

```bash
npm run worker:dev -- --test-scheduled --var APP_PASSWORD:"…" --var JWT_SECRET:"…"
curl "http://localhost:8787/cdn-cgi/handler/scheduled"
```

To get a mail that is already due, snooze one for a minute in the app and trigger after it elapsed, or set the row directly in the local database (the API refuses a time in the past):

```bash
npx wrangler d1 execute DB --local --command "UPDATE messages SET folder='snoozed', snoozed_until=$(node -p 'Date.now() - 1000') WHERE id='<message id>'"
```

The trigger answers `ok`; the mail is then back in the Inbox, unread. Run it again and nothing happens.

---

## ☁️ Production Deployment

The app is served at **https://mail.duongnamtruong.com** and nowhere else. `wrangler.jsonc` declares that hostname as a [Custom Domain](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/) (`routes` with `custom_domain: true`) and sets `workers_dev: false` and `preview_urls: false`, so the Worker gets no `*.workers.dev` or preview URL ([workers.dev](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/), [preview URLs](https://developers.cloudflare.com/workers/configuration/previews/)). `wrangler deploy` creates the DNS record and the certificate for the Custom Domain itself; the zone must be active on Cloudflare and the hostname must not have a CNAME record. After the first deploy, check **Workers & Pages &rarr; edging-mail &rarr; Settings &rarr; Domains & Routes**: only `mail.duongnamtruong.com` should be listed.

Every command below changes your real Cloudflare account: run them yourself, in this order.

### 1. Create the D1 database and the R2 bucket

```bash
npx wrangler d1 create edging_mail_db
npx wrangler r2 bucket create edging-mail-storage
```

Paste the printed `database_id` into `d1_databases[0].database_id` in `wrangler.jsonc`. The id in this repo belongs to the maintainer's account: if you fork the project, replace it with your own. An id is not a secret (it only works with your account's API token), but `wrangler deploy` refuses a binding without a real one (`binding DB of type d1 must have a valid database_id`, code 10021). R2 needs an R2 subscription on the account; it is free to start ([R2 get started](https://developers.cloudflare.com/r2/get-started/)).

### 2. Apply the migrations to the remote D1

```bash
npm run db:migrate:remote
```

**Deploying with Workers Builds (Git push):** the token Cloudflare creates for it has no D1 permission (Workers Scripts, KV, R2 and Routes only, see [Builds configuration](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/#api-token)), so a build can neither create the database nor run migrations. Do steps 1 and 2 from your own machine, and run `npm run db:migrate:remote` again before you push a change that adds a `drizzle/NNNN_*.sql` file. If you would rather migrate in the build, add **D1 Edit** to the build token and set the deploy command to `npm run db:migrate:remote && npx wrangler deploy`.

### 3. Keys, secrets and vars

Generate the VAPID key pair as shown under "VAPID keys". The two public values go into `wrangler.jsonc` under `vars` (a plain `wrangler deploy` deletes vars that exist only in the dashboard, unless you pass `--keep-vars`); the three secrets are stored with Wrangler:

```jsonc
"vars": { /* APP_NAME, DEFAULT_FROM, */ "VAPID_PUBLIC_KEY": "<printed public key>", "VAPID_SUBJECT": "mailto:hi@duongnamtruong.com" }
```

```bash
npx wrangler secret put APP_PASSWORD
npx wrangler secret put JWT_SECRET
npx wrangler secret put VAPID_PRIVATE_KEY
```

The Worker does not exist before the first deploy, so the first `secret put` asks "Do you want to create a new Worker with that name and add secrets to it?": answer yes. That prompt comes from Wrangler itself, not from the docs page; the deploy in step 4 replaces the empty Worker and keeps the secrets. Alternative: `npx wrangler deploy --secrets-file <json file>` uploads secrets together with the code ([Secrets](https://developers.cloudflare.com/workers/configuration/secrets/)). Until `APP_PASSWORD` and `JWT_SECRET` exist, login answers `503` and nothing else is reachable.

### 4. Deploy

```bash
npm run deploy   # npm run build, then wrangler deploy
```

Open https://mail.duongnamtruong.com and sign in. A new Cron Trigger can take up to 15 minutes to propagate, so snoozed mail may not return during the first minutes ([Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/)).

### 5. Send as hi@duongnamtruong.com

Email Sending is in beta and sending to arbitrary recipients needs the **Workers Paid** plan ([pricing](https://developers.cloudflare.com/email-service/platform/pricing/)).

1. In the dashboard: **Compute &rarr; Email Service &rarr; Email Sending &rarr; Onboard Domain**, choose `duongnamtruong.com` ([domain configuration](https://developers.cloudflare.com/email-service/configuration/domains/)).
2. Cloudflare adds MX records and an SPF TXT on `cf-bounce.duongnamtruong.com`, a DKIM TXT on `cf-bounce._domainkey.duongnamtruong.com` and a DMARC TXT on `_dmarc.duongnamtruong.com`. Review them in the dialog before you accept.
3. The root of the domain belongs to Proton, so:
   - **Do not touch the MX records** of `duongnamtruong.com`; they stay at Proton.
   - **SPF:** a name may carry only one SPF record. The sending SPF is on `cf-bounce.`, so the root record (at the time of writing `v=spf1 include:_spf.protonmail.ch ~all`) needs no change. If the dashboard ever asks for an SPF entry on the root, merge it into the existing record instead of adding a second one: `v=spf1 include:_spf.protonmail.ch include:_spf.mx.cloudflare.net ~all` (SPF allows 10 DNS lookups in total).
   - **DMARC:** a domain may carry only one DMARC record, and `_dmarc.duongnamtruong.com` already holds `v=DMARC1; p=quarantine`. What the onboarding does with an existing DMARC record is not documented: check in the dashboard, and afterwards `dig +short TXT _dmarc.duongnamtruong.com` must still show exactly one `v=DMARC1` record.
   - Leave Proton's DKIM records alone: DKIM selectors have different names and do not conflict (Cloudflare's selector is `cf-bounce`).
4. Wait 5-15 minutes, then check the records under **Email Sending &rarr; Settings**. Until the domain is onboarded you can only send to verified destination addresses of the account.

**Replies leave as hi@duongnamtruong.com**, sent through Cloudflare Email Sending and not through Proton. They do not appear in Proton's Sent folder, and an answer to your reply goes to hi@duongnamtruong.com, i.e. to Proton and, through the forwarding below, to this app.

### 6. Receive hi@duongnamtruong.com without breaking Proton

The root MX records of `duongnamtruong.com` point at Proton and have to stay there: onboarding Email Routing on a domain whose MX belongs to another provider fails with error 2008 ("Non-Cloudflare MX records exist"), and replacing those records would stop Proton from receiving mail ([moving to Email Routing](https://developers.cloudflare.com/email-service/configuration/domains/#move-to-email-routing-from-another-provider)). Inbound mail therefore takes two hops:

```
hi@duongnamtruong.com (Proton)  ── forwarding rule ──▶  inbox@mail.duongnamtruong.com (Email Routing)  ──▶  this Worker
```

**a. Email Routing on the subdomain** ([subdomains](https://developers.cloudflare.com/email-service/configuration/subdomains/), [routing rules](https://developers.cloudflare.com/email-service/configuration/email-routing-addresses/)). Deploy the Worker first (step 4): a rule can only point at an existing Worker.

1. **Compute &rarr; Email Service &rarr; Email Routing**, select `duongnamtruong.com`, open **Settings**, and under **Subdomains** add `mail.duongnamtruong.com`. Cloudflare adds the DNS records to that subdomain; the root MX stays at Proton.
2. **Routing Rules &rarr; Create routing rule**: address `inbox` on `mail.duongnamtruong.com`, action **Send to a Worker**, destination `edging-mail`. Catch-all rules exist only for the apex domain, so every address on the subdomain is a literal rule.
3. Check: `dig +short MX mail.duongnamtruong.com` lists Cloudflare's servers, `dig +short MX duongnamtruong.com` still lists `mail.protonmail.ch` and `mailsec.protonmail.ch`. A mail sent to `inbox@mail.duongnamtruong.com` from any account shows up in the Inbox.

**b. Proton forwarding rule** ([Proton: email forwarding](https://proton.me/support/email-forwarding)).

1. In Proton: **Settings &rarr; All settings &rarr; Forward and auto-reply &rarr; Add forwarding rule**. Forward from `hi@duongnamtruong.com` to `inbox@mail.duongnamtruong.com`, no condition, then **Send confirmation email**.
2. Proton sends a confirmation message to the destination address and the rule stays inactive until it is accepted. That message arrives in this app's Inbox (step a): open it and click **Accept forwarding**. If the button does not open from the app, the link is also in the raw message (`GET /api/raw/:id`).
3. Forwarding is available on Proton Mail Plus, Proton Unlimited and the other paid Proton Mail plans. Forwarding to a non-Proton address turns off end-to-end encryption for the forwarded address, and a forwarded mail cannot be forwarded again.
4. Send a test mail to `hi@duongnamtruong.com` from another provider: it appears in this app's Inbox.

**Not confirmed by the docs** (check on the first test): that Cloudflare accepts a Custom Domain and MX records on the same hostname `mail.duongnamtruong.com` (the docs only forbid a CNAME there; if it refuses, route inbound mail on another subdomain such as `in.duongnamtruong.com`); the exact DNS records added to a routing subdomain; how Proton re-sends forwarded mail (Email Routing validates DMARC and records the result in `Authentication-Results`, but the docs do not say what happens on a failure, so try a sender with a strict DMARC policy); and the Proton confirmation flow itself, which has not been run end to end.

On the Workers Free plan an Email Worker can exceed the CPU limit on large mails ([limits](https://developers.cloudflare.com/email-service/platform/limits/)); Email Routing itself is free, Email Sending needs Workers Paid.

### Alternative: move the root MX to Cloudflare

Enable Email Routing on `duongnamtruong.com` itself and route `hi@duongnamtruong.com` to the Worker. Cloudflare requires the old provider's MX records to be removed first, so **Proton stops receiving mail for the domain**: only do this if you give up the Proton mailbox. The forwarding rule from step 6 is then unnecessary.

Documentation checked on 4 November 2026.

---

## 📜 License

MIT License. Free to use, fork, and self-host on Cloudflare.
