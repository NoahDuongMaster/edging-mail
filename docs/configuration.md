# Configuration

Configuration lives in four places:

1. **`wrangler.jsonc`**: bindings, the route and non-secret variables. Committed.
2. **Worker secrets**: `JWT_SECRET`, `DATA_KEY` and `APP_PASSWORD` (the setup key), and `DATA_KEY_PREVIOUS` during a rotation. Set with `wrangler secret put` in production and `.dev.vars` locally. Never committed.
3. **The admin console**: domains, accounts, aliases, the two-step requirement and the default language, stored in D1.
4. **Settings in the app**: each person's display name, signature and language, stored in D1.

- [Bindings](#bindings)
- [Variables and secrets](#variables-and-secrets)
- [`DATA_KEY`](#data_key)
- [Local development: `.dev.vars`](#local-development-devvars)
- [Generating values](#generating-values)
- [Web Push keys](#web-push-keys)
- [Settings in the app and the console](#settings-in-the-app-and-the-console)
- [`wrangler.jsonc` reference](#wranglerjsonc-reference)
- [What a fork must change](#what-a-fork-must-change)

## Bindings

Declared in `wrangler.jsonc`, typed in `src/worker/types.ts` (`Env`).

| Binding      | Kind                         | Value in this repo                                                                                                                                    | Purpose                                                                                                                                                                                                                                        |
| ------------ | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DB`         | D1 database                  | `edging_mail_db`, `migrations_dir: "drizzle"`                                                                                                         | Accounts, the encrypted mail index, settings, push, throttle, audit                                                                                                                                                                            |
| `BUCKET`     | R2 bucket                    | `edging-mail-storage`                                                                                                                                 | Encrypted raw messages and attachments (`em1/<account>/<message>/…`). Dedicated to this app: after an upgrade the cron deletes every object under `raw/`, `sent/`, `attachments/` that no row points at, so a shared bucket loses such objects |
| `SEND_EMAIL` | `send_email` (Email Sending) | declared without restrictions                                                                                                                         | Outbound mail. Optional: without it, sending answers `502`                                                                                                                                                                                     |
| `ASSETS`     | Static assets                | `./dist/client`, `not_found_handling: "none"`, `run_worker_first` for `/api/*`, the landing paths, `/app`, `/app/*`, `/robots.txt` and `/sitemap.xml` | Serves the built React app (the Worker serves the app shell at `/app`)                                                                                                                                                                         |
| `MAIL_HUB`   | Durable Object namespace     | class `MailHub`, SQLite migration tag `v1`                                                                                                            | Realtime WebSocket fan-out, one object per account                                                                                                                                                                                             |

Inbound mail needs no binding: Email Routing calls the Worker's `email()` handler directly.

## Variables and secrets

| Name                 | Kind   | Required  | Constraint                                   | Purpose                                                                                                                                        |
| -------------------- | ------ | --------- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `JWT_SECRET`         | secret | yes       | at least 32 characters                       | Signs the session cookie and the two-step sign-in challenge                                                                                    |
| `DATA_KEY`           | secret | yes       | base64 of exactly 32 random bytes            | Protects what the server must read back (see [`DATA_KEY`](#data_key))                                                                          |
| `DATA_KEY_PREVIOUS`  | secret | no        | same format                                  | The old `DATA_KEY` while you rotate it                                                                                                         |
| `APP_PASSWORD`       | secret | for Setup | at least 24 characters                       | The **setup key**: needed for the first-run Setup and for break-glass recovery of an admin. It is not anybody's sign-in password               |
| `DEFAULT_FROM`       | var    | no        | a bare email address                         | Pre-fills the sender address on the Setup screen (the first admin's address); every other person sends only from their own address             |
| `APP_NAME`           | var    | no        | default `Edging Mail`                        | Product name in `GET /api/health` and in the titles of push notifications                                                                      |
| `LANDING_PAGE`       | var    | no        | `on` (after trim and lower-casing), else off | `on` serves the public landing pages at `/`, `/en/` and `/zh/`; anything else, or unset, keeps them off and `/` is the app                     |
| `ENCRYPT_CHUNK_ROWS` | var    | no        | an integer, 1 to 500, default 25             | Tuning: how many old plaintext rows the cron converts per run                                                                                  |
| `ALLOW_LOCAL_PUSH`   | var    | no        | `on` (after trim and lower-casing), else off | Local development only: also accepts a Web Push endpoint on loopback over http or https, for a fake push service. Never set it on a deployment |

- Without a usable `JWT_SECRET` or `DATA_KEY`, sign-in and Setup answer `503` and nothing else is reachable. While Setup has not been done, `GET /api/auth/session`
  lists the **names** (never the values) of the secrets that are missing or invalid, so the Setup screen can say what to fix. After Setup it lists nothing.
- `APP_PASSWORD` may be absent after Setup; without it only Setup and break-glass are off.
- The three secrets must be different from each other: a `DATA_KEY` that equals `JWT_SECRET` or `APP_PASSWORD` is refused, and so is a `DATA_KEY_PREVIOUS` that equals
  one of the other secrets.
- Web Push has no variables of its own: the Worker creates its key pair itself, see [Web Push keys](#web-push-keys).
- `APP_NAME` is not used for the page title, the PWA manifest or the Settings screen: those are static (`index.html`, `public/manifest.webmanifest`). Edit them if you
  rebrand.
- A plain `wrangler deploy` deletes variables that exist only in the dashboard (unless you pass `--keep-vars`), so keep `vars` in `wrangler.jsonc`.

**Defaults, how to make a value, and what happens when it changes or is lost:**

| Name                 | Default                                                                             | How to make it                             | If you change it, or lose it                                                                                                                                                                                                                                                                                                  |
| -------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `JWT_SECRET`         | none: required                                                                      | `openssl rand -hex 32`                     | Every session and every open two-step challenge stops working at once; everybody signs in again. Nothing stored is lost, with one exception: an install upgraded from the single-user version whose first push has not happened yet (its old push key is still sealed under this secret, see [Web Push keys](#web-push-keys)) |
| `DATA_KEY`           | none: required                                                                      | `openssl rand -base64 32`                  | See [`DATA_KEY`](#data_key): rotate it with `DATA_KEY_PREVIOUS`; changed without it, TOTP secrets and pending mail become unreadable and the Web Push pair is replaced (devices turn notifications on again). Mail of people who have keys is not affected                                                                    |
| `DATA_KEY_PREVIOUS`  | unset                                                                               | the old `DATA_KEY`, during a rotation only | While it is set, values sealed under it stay readable. Delete it and they are lost                                                                                                                                                                                                                                            |
| `APP_PASSWORD`       | none: needed only for Setup and break-glass                                         | `openssl rand -base64 24`                  | Only Setup and break-glass depend on it: the new value is the setup key from then on. No account, session or stored value depends on it. Unset or shorter than 24 characters, those two answer `503` and people can still sign in                                                                                             |
| `DEFAULT_FROM`       | set in this repo's `wrangler.jsonc` (the maintainer's address); a fork sets its own | an address you own                         | The address the Setup screen offers (until Setup is done) and, when it is a valid address, the `mailto:` contact of Web Push requests (otherwise the contact is the address of the person being notified). Nothing stored changes                                                                                             |
| `APP_NAME`           | `Edging Mail`                                                                       | any text                                   | The product name in `GET /api/health` and in push notification titles. Not the page title or the manifest                                                                                                                                                                                                                     |
| `LANDING_PAGE`       | off (unset)                                                                         | `on`                                       | Turns the public landing pages on or off; `/app` is the app either way. Nothing stored changes                                                                                                                                                                                                                                |
| `ENCRYPT_CHUNK_ROWS` | 25                                                                                  | an integer                                 | Only how fast old plaintext mail is converted. Not a number: 25; below 1 or above 500: clamped to 1 or 500                                                                                                                                                                                                                    |
| `ALLOW_LOCAL_PUSH`   | off (unset)                                                                         | `on`, in `.dev.vars` only                  | Lets `POST /api/push/subscribe` accept an endpoint on loopback over http or https. Never on a deployment                                                                                                                                                                                                                      |

## `DATA_KEY`

`DATA_KEY` is the one new secret a deployment needs. Generate it once and keep a copy in your password manager:

```bash
openssl rand -base64 32
```

The Worker accepts it only when it is the canonical base64 of exactly 32 bytes, has at least 8 distinct byte values, and differs from `JWT_SECRET` and `APP_PASSWORD`. The
placeholder in `.dev.vars.example` (`AAAA…=`, all zero bytes) fails this on purpose.

What it protects, and what it does not:

- It seals only what the server has to read back: the content keys of mail that arrived before its owner had keys, the TOTP secrets, the MACs of 2FA recovery codes and of
  forgot-password tickets, the audit MACs, and the Web Push signing key. It is **not** the key of anyone's mail; mail of a person who has keys never depends on it.
- While it is missing or invalid: sign-in and Setup answer `503`; push stops; mail for people who already have keys still arrives; mail for people who have **no** keys
  yet (and mail from before Setup) is refused with a permanent SMTP error, which bounces the sender, and a bounced mail cannot be recovered. Fix the secret before you
  take mail.
- **Losing it** makes TOTP secrets and pending mail unreadable (those people re-enrol two-step verification through an admin reset; pending mail is lost). Everything
  else, including every mailbox of people who have keys, survives.

**Rotating it:**

1. Put the new value in `DATA_KEY` and the old value in `DATA_KEY_PREVIOUS` (`npx wrangler secret put …`), then deploy.
2. The Worker reads values sealed under either key and seals every new value under the new key. This version does **not** re-seal what is already stored, so the
   TOTP secrets, pending mail and push key that were sealed under the old key stay readable only while `DATA_KEY_PREVIOUS` stays set. Keep it set for as long as you
   want those values; delete it only when you accept that the people whose TOTP secret was sealed under it re-enrol two-step verification (an admin resets it) and that
   pending mail still sealed under it is lost.

## Local development: `.dev.vars`

`wrangler dev` reads a `.dev.vars` file next to `wrangler.jsonc`. It is gitignored. Start from the template:

```bash
cp .dev.vars.example .dev.vars    # then replace every placeholder value
npm run worker:dev
```

The template contains values that are rejected on purpose (`JWT_SECRET=CHANGE_ME` is too short, `DATA_KEY` is all zero bytes, `APP_PASSWORD=CHANGE_ME` is too short):
until you replace them, sign-in answers `503` instead of accepting a secret everybody can read on GitHub. The `APP_NAME` / `DEFAULT_FROM` overrides are commented out.

`npm test` does not read `.dev.vars` (the test configuration has fixed test values and no wrangler config file on purpose).

## Generating values

```bash
openssl rand -hex 32       # JWT_SECRET (64 characters)
openssl rand -base64 32    # DATA_KEY (44 characters, 32 bytes)
openssl rand -base64 24    # APP_PASSWORD, the setup key (32 characters; the Worker needs at least 24)
```

Production secrets are stored with Wrangler and prompted for, so they never touch the repository:

```bash
npx wrangler secret put JWT_SECRET
npx wrangler secret put DATA_KEY
npx wrangler secret put APP_PASSWORD
```

## Web Push keys

Nothing to configure. Web Push signs its requests with a VAPID key pair (RFC 8292), and the Worker creates that pair itself the first time push is needed: the first
`GET /api/push/public-key` (the notification switch in **Settings**), `POST /api/push/subscribe`, `POST /api/push/test`, or an inbound mail while at least one device
is subscribed. An install where nobody turns notifications on never creates a key.

| Part                            | How it works                                                                                                                                                       |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Where it lives                  | D1 table `push_keys`, a single row with `id` 1 (`public_key`, `private_key_sealed`, `created_at`)                                                                  |
| How the private half is stored  | Sealed with AES-256-GCM under a key derived from `DATA_KEY` (HKDF-SHA256), with the public key as associated data. A copy of the database alone cannot sign pushes |
| Contact claim (`sub`, RFC 8292) | `mailto:` plus `DEFAULT_FROM` when it is a valid address; otherwise `mailto:` plus the address of the person being notified. Never a value of the upstream project |
| Without `DATA_KEY`              | Push is unavailable: `public-key`, `subscribe` and `test` answer `503`, and no key is created. An inbound mail is never refused because of push                    |

**Changing `DATA_KEY` without `DATA_KEY_PREVIOUS`** makes the stored pair unreadable. The next time push is needed the Worker creates a new pair and removes every
registered device, because the push services would refuse subscriptions made for the old key; afterwards each device shows notifications as off, and people turn them on
again in **Settings → Notifications**. With `DATA_KEY_PREVIOUS` set during a rotation nothing is lost while it stays set. Changing `JWT_SECRET` or `APP_PASSWORD` does not touch the push key.
**Upgrading from the single-user version:** that version sealed its key pair under `JWT_SECRET`. The first time push is needed, the Worker reads the pair with `JWT_SECRET`, seals it
under `DATA_KEY` and keeps the devices. From then on the push key does not depend on `JWT_SECRET`, as long as this conversion is the only thing that ever read the old format: it
is a small piece of code that is removed in the first release after the upgrade window, and until the first push after the upgrade the old pair is still sealed under `JWT_SECRET`.
Change `JWT_SECRET` before that moment and the old pair is unreadable: it is replaced and every device turns notifications on again. The Worker then logs one line without any value
(`push: the stored VAPID pair could not be opened; a new pair was made and N device(s) removed`), so an operator can tell why notifications went off. The key is moved, not rotated:
the upgrade guide ([Deployment](deployment.md)) says what that means if you want a new pair.
More in [Realtime, Web Push and PWA](pwa-and-push.md).

## Settings in the app and the console

**Settings** (in the app) stores three values per person on their user row. They need no redeploy.

| Key            | Limit                                                          | Fallback                                     |
| -------------- | -------------------------------------------------------------- | -------------------------------------------- |
| `display_name` | one line, at most 100 characters                               | empty: the `From` header is the bare address |
| `signature`    | at most 2000 characters                                        | empty                                        |
| `language`     | one of the app's languages (today `en`, `vi`, `zh-CN`) or none | the organisation's default language          |

The sender of a mail is always the signed-in person's own primary address (and display name); a request that names another `From` address is refused. The address must
belong to a domain onboarded in Email Sending.

The **admin console** (`/api/admin`, admins only) holds the rest, in D1: the list of mail domains (with a DNS check that reports whether a domain is ready to receive and
to send), the accounts and their aliases, the organisation's `require_2fa` switch (on by default; an admin can relax it for members with a typed confirmation and a
second-factor check) and the default language (set at Setup, changeable later), and the audit log. See the [API reference](api.md#admin).

## `wrangler.jsonc` reference

| Key                                          | Value                                       | Why                                                                                                                                                                                                                                                                 |
| -------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`                                       | `edging-mail`                               | Worker name; Email Routing rules point at it                                                                                                                                                                                                                        |
| `main`                                       | `src/worker/index.ts`                       | Entry point (exports `fetch`, `email`, `scheduled` and the `MailHub` class)                                                                                                                                                                                         |
| `compatibility_date` / `compatibility_flags` | `2024-09-23` / `nodejs_compat`              | Runtime behaviour                                                                                                                                                                                                                                                   |
| `routes`                                     | one Custom Domain                           | The hostname the app is served on (`custom_domain: true`)                                                                                                                                                                                                           |
| `workers_dev`, `preview_urls`                | `false`, `false`                            | No `*.workers.dev` or preview URL: the app is reachable only on your hostname                                                                                                                                                                                       |
| `dev.host`                                   | `localhost`                                 | Without it `wrangler dev` tells the Worker its URL is the `routes` hostname, and the WebSocket `Origin` check then refuses the Vite dev server                                                                                                                      |
| `triggers.crons`                             | `["* * * * *"]`                             | Every minute: returns due snoozed mail, converts old plaintext mail, re-wraps pending mail, applies due two-step resets of admins, deletes locked old mail whose deletion was asked for seven days ago; at minute 7 of each hour it also prunes old sign-in records |
| `migrations`                                 | tag `v1`, `new_sqlite_classes: ["MailHub"]` | Durable Object class migration                                                                                                                                                                                                                                      |
| `vars`                                       | `APP_NAME`, `DEFAULT_FROM`, `LANDING_PAGE`  | Non-secret variables                                                                                                                                                                                                                                                |

## What a fork must change

`wrangler.jsonc` in this repository carries the maintainer's own deployment values (a hostname, a D1 id that only works with the maintainer's Cloudflare account, and a default
sender). Replace each of them before you deploy:

| Key                                                          | Change to                                                                                                                        |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| `routes[0].pattern`                                          | a hostname on a zone in your Cloudflare account                                                                                  |
| `d1_databases[0].database_id`                                | the id printed by `wrangler d1 create`                                                                                           |
| `vars.DEFAULT_FROM`                                          | an address on a domain you onboard in Email Sending                                                                              |
| `vars.APP_NAME`                                              | optional                                                                                                                         |
| `vars.LANDING_PAGE`                                          | `on` only if you want the public landing pages; they describe the hosted product and carry its links, so most forks leave it off |
| `d1_databases[0].database_name`, `r2_buckets[0].bucket_name` | optional: any names, as long as you create them with the same names (the files say `edging_mail_db` and `edging-mail-storage`)   |

A D1 id is not a secret (it only works with the owning account's API token), but `wrangler deploy` refuses a binding without a real one
(`binding DB of type d1 must have a valid database_id`, code 10021). See [Deployment](deployment.md).
