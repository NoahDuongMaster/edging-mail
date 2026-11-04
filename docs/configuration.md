# Configuration

Configuration lives in three places:

1. **`wrangler.jsonc`**: bindings, the route and non-secret variables. Committed.
2. **Worker secrets**: the password, the cookie signing key and the VAPID private key. Set with `wrangler secret put` in production and `.dev.vars` locally. Never
   committed.
3. **The Settings screen**: display name, signature and default sender, stored in D1.

- [Bindings](#bindings)
- [Variables and secrets](#variables-and-secrets)
- [Local development: `.dev.vars`](#local-development-devvars)
- [Generating values](#generating-values)
- [VAPID keys](#vapid-keys)
- [Settings in the app](#settings-in-the-app)
- [`wrangler.jsonc` reference](#wranglerjsonc-reference)
- [What a fork must change](#what-a-fork-must-change)

## Bindings

Declared in `wrangler.jsonc`, typed in `src/worker/types.ts` (`Env`).

| Binding      | Kind                         | Value in this repo                                                                | Purpose                                                    |
| ------------ | ---------------------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `DB`         | D1 database                  | `edging_mail_db`, `migrations_dir: "drizzle"`                                     | Mail index, settings, push subscriptions, login throttle   |
| `BUCKET`     | R2 bucket                    | `edging-mail-storage`                                                             | Raw `.eml` files and attachments                           |
| `SEND_EMAIL` | `send_email` (Email Sending) | declared without restrictions                                                     | Outbound mail. Optional: without it, sending answers `502` |
| `ASSETS`     | Static assets                | `./dist/client`, single-page-application fallback, `run_worker_first: ["/api/*"]` | Serves the built React app                                 |
| `MAIL_HUB`   | Durable Object namespace     | class `MailHub`, SQLite migration tag `v1`                                        | Realtime WebSocket fan-out                                 |

Inbound mail needs no binding: Email Routing calls the Worker's `email()` handler directly.

## Variables and secrets

| Name                | Kind   | Required | Constraint                   | Purpose                                                                                               |
| ------------------- | ------ | -------- | ---------------------------- | ----------------------------------------------------------------------------------------------------- |
| `APP_PASSWORD`      | secret | yes      | at least 12 characters       | The password you type on the login screen                                                             |
| `JWT_SECRET`        | secret | yes      | at least 32 characters       | Random key that signs the session cookie                                                              |
| `DEFAULT_FROM`      | var    | no       | a bare email address         | Sender address used until you save one in Settings                                                    |
| `APP_NAME`          | var    | no       | default `Edging Mail`        | Product name in `GET /api/health` and in the titles of the test and snooze-summary push notifications |
| `VAPID_PUBLIC_KEY`  | var    | for push | base64url, 65-byte P-256 key | Public half of the Web Push key pair                                                                  |
| `VAPID_SUBJECT`     | var    | for push | `mailto:` or `https://` URL  | Contact for the push services (RFC 8292)                                                              |
| `VAPID_PRIVATE_KEY` | secret | for push | base64url, 32 bytes          | Private half of the key pair                                                                          |

- Without `APP_PASSWORD` or `JWT_SECRET`, or with one that is too short, login answers `503` and nothing else is reachable.
- Push works only when all three VAPID values are set. If one is missing, push is off and mail and realtime keep working.
- `APP_NAME` is not used for the page title, the PWA manifest or the Settings screen: those are static (`index.html`, `public/manifest.webmanifest`). Edit them if you
  rebrand.
- A plain `wrangler deploy` deletes variables that exist only in the dashboard (unless you pass `--keep-vars`), so keep `vars` in `wrangler.jsonc`.

## Local development: `.dev.vars`

`wrangler dev` reads a `.dev.vars` file next to `wrangler.jsonc`. It is gitignored. Start from the template:

```bash
cp .dev.vars.example .dev.vars    # then replace the placeholder values
npm run worker:dev
```

The template contains `APP_PASSWORD=CHANGE_ME` and `JWT_SECRET=CHANGE_ME`. They are too short on purpose: until you replace them, login answers `503` instead of
accepting a password everybody can read on GitHub. The VAPID entries and the `APP_NAME` / `DEFAULT_FROM` overrides are commented out.

You can also pass values on the command line instead of using a file:

```bash
npm run worker:dev -- --var APP_PASSWORD:"a-long-random-password" --var JWT_SECRET:"$(openssl rand -hex 32)"
```

## Generating values

```bash
openssl rand -base64 24    # APP_PASSWORD (32 characters)
openssl rand -hex 32       # JWT_SECRET (64 characters)
```

Production secrets are stored with Wrangler and prompted for, so they never touch the repository:

```bash
npx wrangler secret put APP_PASSWORD
npx wrangler secret put JWT_SECRET
npx wrangler secret put VAPID_PRIVATE_KEY
```

## VAPID keys

Generate a key pair once:

```bash
node -e "const k=require('node:crypto').generateKeyPairSync('ec',{namedCurve:'P-256'}).privateKey.export({format:'jwk'});const b=(s)=>Buffer.from(s,'base64url');console.log('VAPID_PUBLIC_KEY='+Buffer.concat([Buffer.from([4]),b(k.x),b(k.y)]).toString('base64url'));console.log('VAPID_PRIVATE_KEY='+k.d)"
```

| Name                | Kind   | Value                                                                              |
| ------------------- | ------ | ---------------------------------------------------------------------------------- |
| `VAPID_PUBLIC_KEY`  | var    | the printed public key; add it under `vars` in `wrangler.jsonc`                    |
| `VAPID_SUBJECT`     | var    | `mailto:you@yourdomain.com` (or an `https://` URL); add it under `vars` as well    |
| `VAPID_PRIVATE_KEY` | secret | the printed private key: `npx wrangler secret put VAPID_PRIVATE_KEY`, never commit |

Locally, put the three values in `.dev.vars`, or pass `--var VAPID_PUBLIC_KEY:… --var VAPID_PRIVATE_KEY:… --var VAPID_SUBJECT:mailto:…`.

Changing the key pair invalidates existing subscriptions: turn notifications off and on again on each device. More in
[Realtime, Web Push and PWA](pwa-and-push.md).

## Settings in the app

**Settings** (in the app) stores three values in D1. They need no redeploy.

| Key            | Limit                            | Fallback                                     |
| -------------- | -------------------------------- | -------------------------------------------- |
| `display_name` | one line, at most 100 characters | empty: the `From` header is the bare address |
| `signature`    | at most 2000 characters          | empty                                        |
| `default_from` | a bare email address, or empty   | the `DEFAULT_FROM` var                       |

The sender of a mail is the first of: the `from` of the request, the saved `default_from`, `DEFAULT_FROM`. If none is set, sending is refused with
`No sender address configured`. The address must belong to a domain onboarded in Email Sending.

## `wrangler.jsonc` reference

| Key                                          | Value                                       | Why                                                                                                                                            |
| -------------------------------------------- | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`                                       | `edging-mail`                               | Worker name; Email Routing rules point at it                                                                                                   |
| `main`                                       | `src/worker/index.ts`                       | Entry point (exports `fetch`, `email`, `scheduled` and the `MailHub` class)                                                                    |
| `compatibility_date` / `compatibility_flags` | `2024-09-23` / `nodejs_compat`              | Runtime behaviour                                                                                                                              |
| `routes`                                     | one Custom Domain                           | The hostname the app is served on (`custom_domain: true`)                                                                                      |
| `workers_dev`, `preview_urls`                | `false`, `false`                            | No `*.workers.dev` or preview URL: the app is reachable only on your hostname                                                                  |
| `dev.host`                                   | `localhost`                                 | Without it `wrangler dev` tells the Worker its URL is the `routes` hostname, and the WebSocket `Origin` check then refuses the Vite dev server |
| `triggers.crons`                             | `["* * * * *"]`                             | Every minute: returns due snoozed mail                                                                                                         |
| `migrations`                                 | tag `v1`, `new_sqlite_classes: ["MailHub"]` | Durable Object class migration                                                                                                                 |
| `vars`                                       | `APP_NAME`, `DEFAULT_FROM`                  | Non-secret variables; add the two VAPID vars here                                                                                              |

## What a fork must change

`wrangler.jsonc` in this repository carries the maintainer's own deployment values. Replace them before you deploy:

| Key                                                          | Maintainer's value (example only)                   | Change to                                                           |
| ------------------------------------------------------------ | --------------------------------------------------- | ------------------------------------------------------------------- |
| `routes[0].pattern`                                          | `mail.duongnamtruong.com`                           | a hostname on a zone in your Cloudflare account                     |
| `d1_databases[0].database_id`                                | an id that only works with the maintainer's account | the id printed by `wrangler d1 create`                              |
| `vars.DEFAULT_FROM`                                          | `hi@duongnamtruong.com`                             | an address on a domain you onboard in Email Sending                 |
| `vars.APP_NAME`                                              | `Edging Mail`                                       | optional                                                            |
| `d1_databases[0].database_name`, `r2_buckets[0].bucket_name` | `edging_mail_db`, `edging-mail-storage`             | optional: any names, as long as you create them with the same names |

A D1 id is not a secret (it only works with the owning account's API token), but `wrangler deploy` refuses a binding without a real one
(`binding DB of type d1 must have a valid database_id`, code 10021). See [Deployment](deployment.md).
