# Deployment

Edging Mail runs as one Worker on a Custom Domain of your own, with a D1 database, an R2 bucket, a Durable Object and a Cron Trigger. Every command on this page
changes your real Cloudflare account: run them yourself, in this order.

Hostnames below are placeholders: `mail.example.com` is the app, `example.com` is your domain. The checked-in `wrangler.jsonc` carries the maintainer's own values for
the hostname, the D1 id and the default sender: replace each of them first ([What a fork must change](configuration.md#what-a-fork-must-change)).

- [Prerequisites](#prerequisites)
- [1. Make the repository yours](#1-make-the-repository-yours)
- [2. Create the D1 database and the R2 bucket](#2-create-the-d1-database-and-the-r2-bucket)
- [3. Apply the migrations](#3-apply-the-migrations)
- [4. Secrets](#4-secrets)
- [5. Deploy](#5-deploy)
- [6. First-run Setup](#6-first-run-setup)
- [Receive mail (Email Routing)](#receive-mail-email-routing)
- [Send mail from your domain](#send-mail-from-your-domain)
- [After the first deploy: a ten-minute check](#after-the-first-deploy-a-ten-minute-check)
- [Rate limiting](#rate-limiting)
- [Updating](#updating)
- [Upgrading an existing single-user install](#upgrading-an-existing-single-user-install)
- [Cost and plan notes](#cost-and-plan-notes)

## Prerequisites

- A Cloudflare account with a domain whose DNS is on Cloudflare (the zone must be active).
- **The Workers Paid plan for the whole install.** A sign-in checks a password with PBKDF2 (100,000 iterations), which takes about 40-50 ms of CPU; the Workers Free
  limit is 10 ms per request, so on Free the Worker is stopped in the middle of a sign-in. Email Sending to arbitrary recipients needs Workers Paid as well. Receiving
  through Email Routing is free.
- Node.js 24 or newer and npm. No `engines` field or `.nvmrc` pins a version; the lowest the toolchain allows is Node 22.15 (Wrangler 4 needs 22+, Vite 8 needs 22.12+,
  and the ESLint setup uses `module.registerHooks`, added in 22.15).
- Wrangler signed in to your account: `npx wrangler login`.

## 1. Make the repository yours

Fork and clone the repository, then edit `wrangler.jsonc`: replace the route, the D1 id and `DEFAULT_FROM`, and decide on `LANDING_PAGE`. The table with every value is in
[Configuration → What a fork must change](configuration.md#what-a-fork-must-change).

`wrangler.jsonc` declares the hostname as a [Custom Domain](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/) (`routes` with
`custom_domain: true`) and sets `workers_dev: false` and `preview_urls: false`, so the Worker gets no `*.workers.dev` or preview URL
([workers.dev](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/),
[preview URLs](https://developers.cloudflare.com/workers/configuration/previews/)). `wrangler deploy` creates the DNS record and the certificate for the Custom Domain
itself; the zone must be active on Cloudflare and the hostname must not have a CNAME record.

If you have no domain on Cloudflare, you can drop `routes` and set `workers_dev` to `true` to get a `*.workers.dev` URL. That variant is standard Wrangler
configuration but is not what the maintainer runs, and mail still needs a domain.

## 2. Create the D1 database and the R2 bucket

```bash
npx wrangler d1 create edging_mail_db
npx wrangler r2 bucket create edging-mail-storage
```

Paste the printed `database_id` into `d1_databases[0].database_id` in `wrangler.jsonc`. The id in this repository belongs to the maintainer's account, so a fork must
replace it. An id is not a secret (it only works with your account's API token), but `wrangler deploy` refuses a binding without a real one
(`binding DB of type d1 must have a valid database_id`, code 10021). R2 needs an R2 subscription on the account; it is free to start
([R2 get started](https://developers.cloudflare.com/r2/get-started/)).

If you choose other names, change `database_name` and `bucket_name` in `wrangler.jsonc` to match. Use a bucket that only Edging Mail uses: after an upgrade the cron deletes every
object under `raw/`, `sent/` and `attachments/` that no row points at (see step 6 of [Upgrading an existing single-user install](#upgrading-an-existing-single-user-install)).

## 3. Apply the migrations

```bash
npm run db:migrate:remote
```

It is safe to repeat: Wrangler skips migrations it has already applied. Migration `0005_multi_user` adds the accounts, domains, audit, sign-in history, recovery and
two-step tables and the encryption columns; it changes no existing row.

**Deploying with Workers Builds (Git push):** to migrate and deploy on every push, do two things once in the Cloudflare dashboard. First, add **Account → D1 → Edit**
to the build's API token: the token Cloudflare creates by default has no D1 permission (Workers Scripts, KV, R2 and Routes only, see
[Builds configuration](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/#api-token)), so without it a build can neither create the database
nor run migrations. Second, set **Settings → Builds → Deploy command** to `npm run db:migrate:remote && npx wrangler deploy`. The migration step runs before the
deploy, and Wrangler skips migrations it has already applied, so it is safe on every push. If you would rather not give the build token D1 access, do steps 2 and 3
from your own machine and run `npm run db:migrate:remote` again before you push a change that adds a `drizzle/NNNN_*.sql` file.

## 4. Secrets

Three secrets, stored with Wrangler. `APP_NAME`, `DEFAULT_FROM` and `LANDING_PAGE` are plain `vars` in `wrangler.jsonc`.

```bash
npx wrangler secret put JWT_SECRET           # at least 32 characters:  openssl rand -hex 32
npx wrangler secret put DATA_KEY             # base64 of 32 random bytes: openssl rand -base64 32
npx wrangler secret put APP_PASSWORD         # the setup key, at least 24 characters: openssl rand -base64 24
```

The three must be different values. Keep a copy of `DATA_KEY` and `APP_PASSWORD` in a password manager: see [Configuration → `DATA_KEY`](configuration.md#data_key) for what
losing `DATA_KEY` costs.

The Worker does not exist before the first deploy, so the first `secret put` asks "Do you want to create a new Worker with that name and add secrets to it?":
answer yes. That prompt comes from Wrangler itself. The deploy in step 5 replaces the empty Worker and keeps the secrets. Alternative: `npx wrangler deploy
--secrets-file <json file>` uploads secrets together with the code ([Secrets](https://developers.cloudflare.com/workers/configuration/secrets/)).

Until `JWT_SECRET` and `DATA_KEY` exist and are valid, sign-in and Setup answer `503` and nothing else is reachable. Web Push needs nothing else: the Worker creates its own
key pair when notifications are first turned on ([Web Push keys](configuration.md#web-push-keys)).

## 5. Deploy

```bash
npm run deploy    # npm run build, apply the migrations, then wrangler deploy
```

Open `https://mail.example.com`. In the dashboard, **Workers & Pages → edging-mail → Settings → Domains & Routes** should list only your hostname. A new
Cron Trigger can take up to 15 minutes to propagate, so snoozed mail may not return during the first minutes
([Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/)).

## 6. First-run Setup

An empty install shows only the Setup screen, and no account exists until it is done. It asks for the **setup key** (`APP_PASSWORD`), the first admin's address (an
address on your domain: it becomes the admin's primary address and its domain is added to the domain list), a display name, aliases if you want any, a language
(it becomes the organisation's default) and a password of at least 16 characters. The browser then makes the admin's key pair and **recovery key** (54 symbols in 9
groups: write it down, you confirm three groups), and sends only the public key, the wrapped private key and a proof of the recovery key. Then enrol two-step
verification (it is required of every admin).

Mail that arrives before Setup is stored without an owner, sealed under `DATA_KEY`, and handed to the first admin when Setup completes. Add the other domains and
accounts in the admin console afterwards. Create an account only when the person is ready to sign in: an admin knows a new account's temporary password until the
person first signs in (see [Security](security.md#what-admins-can-and-cannot-do)).

## Receive mail (Email Routing)

Inbound mail reaches the app only through Email Routing, which calls the Worker's `email()` handler. Deploy the Worker first: a routing rule can only point at an
existing Worker. A message is stored only for an address that belongs to an account (its primary address or an alias; a `+tag` is ignored); any other recipient is
rejected, so a catch-all rule is safe.

### Option A: Email Routing on your domain (recommended)

Use this when the domain has no other mail host, or when you are willing to give that mailbox up. The admin console's **Check DNS** for a domain answers whether it is
ready to receive and to send.

1. **Compute → Email Service → Email Routing → Onboard Domain**, choose `example.com`. Cloudflare adds MX, SPF and DKIM records on the root domain
   ([domain configuration](https://developers.cloudflare.com/email-service/configuration/domains/)). Cloudflare requires MX records of a previous provider to be removed
   first, so that provider stops receiving mail for the domain.
2. **Routing Rules → Create routing rule**: use the **catch-all** rule of the apex domain with action **Send to a Worker**, destination `edging-mail`, so every address
   of the domain reaches the Worker, which sorts it by account. A rule for single addresses works as well
   ([routing rules](https://developers.cloudflare.com/email-service/configuration/email-routing-addresses/)).
3. Send a test mail to an account's address from another account. It shows up in that person's Inbox.

### Option B: mail hosted elsewhere (forward to a subdomain)

Use this when the root MX records must stay with another provider. Email Routing can run on a subdomain, and the other provider forwards one address to it.

```
you@example.com (other provider) ── forwarding rule ──▶ inbox@mail.example.com (Email Routing) ──▶ this Worker
```

Onboarding Email Routing on a domain whose MX belongs to another provider fails with error 2008 ("Non-Cloudflare MX records exist"), and replacing those records would
stop that provider from receiving mail ([moving to Email Routing](https://developers.cloudflare.com/email-service/configuration/domains/#move-to-email-routing-from-another-provider)).

**a. Email Routing on the subdomain** ([subdomains](https://developers.cloudflare.com/email-service/configuration/subdomains/)).

1. **Compute → Email Service → Email Routing**, select `example.com`, open **Settings**, and under **Subdomains** add `mail.example.com`. Cloudflare adds the DNS
   records to that subdomain; the root MX stays where it is.
2. **Routing Rules → Create routing rule**: address `inbox` on `mail.example.com`, action **Send to a Worker**, destination `edging-mail`. Catch-all rules exist only for
   the apex domain, so every address on the subdomain is a literal rule. Add the subdomain to the domain list in the admin console and create the account as
   `inbox@mail.example.com`.
3. Check: `dig +short MX mail.example.com` lists Cloudflare's servers and `dig +short MX example.com` still lists the old provider. A mail sent to
   `inbox@mail.example.com` from any account shows up in that account's Inbox.

**b. A forwarding rule at the other provider.** In that provider's settings, forward `you@example.com` to `inbox@mail.example.com`. Some providers send a confirmation
message to the destination first; it arrives in the account's Inbox. Other providers differ in what they forward, how they re-sign it and whether it can be forwarded
again, so test with a real mail.

**Not confirmed by the docs** (check on your first test): that Cloudflare accepts a Custom Domain and MX records on the same hostname (the docs only forbid a CNAME
there; if it refuses, route inbound mail on another subdomain such as `in.example.com`); the exact DNS records added to a routing subdomain; and how the other provider
re-sends forwarded mail (Email Routing validates DMARC and records the result in `Authentication-Results`; Cloudflare's "Email lifecycle" page says that mail failing the
sender's DMARC policy is rejected at the authentication check, which comes before rule matching and the Worker, but this is not verified on a real deployment, so try a
sender with a strict DMARC policy).

### Option C: move the root MX to Cloudflare

Enable Email Routing on the root domain and route the addresses to the Worker, as in Option A. Cloudflare requires the old provider's MX records to be removed first, so
that provider **stops receiving mail** for the domain: only do this if you give up that mailbox. The forwarding rule from Option B is then unnecessary.

### Publish SPF, DKIM and DMARC for every domain you host

Mail that arrives by email carries the `From` address its sender wrote, and the Worker cannot check it. Without protection at the domain, anyone can send a message that claims
to be from `ceo@example.com` to every person on it. So, for every domain you onboard:

- Keep the SPF and DKIM records that Email Routing gives you for the domain (**Email Routing → Settings** in the dashboard shows them).
- Publish a DMARC record with the policy `p=reject`, for example a TXT record on `_dmarc.example.com` with `v=DMARC1; p=reject; rua=mailto:dmarc-reports@example.com`. If other services
  send mail as your domain, start with `p=none`, read the reports, move to `p=quarantine`, then to `p=reject`.

What Cloudflare checks: its documentation (Email Routing, "Email lifecycle" and "Postmaster", read on 2026-11-07) says that Email Routing checks SPF, DKIM, DMARC and ARC on every
incoming message, and that mail failing the DMARC policy of the domain it claims is rejected at SMTP, at the authentication check (stage 2 of the inbound flow on the "Email
lifecycle" page), before rule matching and before the message is handed to a Worker. It also rejects a message that neither passes SPF nor has a valid DKIM signature. A domain
without a DMARC policy gets no such protection. **Not verified on a real deployment (UNVERIFIED):** this project could not test it against a real Email Routing route, so treat it as Cloudflare's statement. See
[Security → Mail that claims one of your own addresses](security.md#mail-that-claims-one-of-your-own-addresses) for what the app adds on top (`origin` and `from_hosted` on every message).

## Send mail from your domain

Email Sending is in beta, and sending to arbitrary recipients needs the **Workers Paid** plan ([pricing](https://developers.cloudflare.com/email-service/platform/pricing/)).

1. In the dashboard: **Compute → Email Service → Email Sending → Onboard Domain**, choose `example.com`
   ([domain configuration](https://developers.cloudflare.com/email-service/configuration/domains/)).
2. Cloudflare adds MX records and an SPF TXT on `cf-bounce.example.com`, a DKIM TXT on `cf-bounce._domainkey.example.com` and a DMARC TXT on `_dmarc.example.com`.
   Review them in the dialog before you accept.
3. If another provider hosts the mail of the root domain:
   - **Do not touch the MX records** of `example.com`; they stay where they are.
   - **SPF:** a name may carry only one SPF record. The sending SPF is on `cf-bounce.`, so the root record needs no change. If the dashboard ever asks for an SPF entry
     on the root, merge it into the existing record instead of adding a second one, adding `include:_spf.mx.cloudflare.net` (SPF allows 10 DNS lookups in total).
   - **DMARC:** a domain may carry only one DMARC record. What the onboarding does with an existing one is not documented: check in the dashboard, and afterwards
     `dig +short TXT _dmarc.example.com` must still show exactly one `v=DMARC1` record.
   - Leave the other provider's DKIM records alone: DKIM selectors have different names and do not conflict (Cloudflare's sending selector is `cf-bounce`).
4. Wait 5-15 minutes, then check the records under **Email Sending → Settings**, or use **Check DNS** in the admin console. Until the domain is onboarded you can only send
   to verified destination addresses of the account.

Everybody sends only from their own primary address. Replies leave as that address, sent through Cloudflare Email Sending. An answer to a reply goes to the
address, so to Email Routing and into the account's Inbox.

## After the first deploy: a ten-minute check

The tests run in a local workerd with fixed values and fake services, so they did not cover the following. Once mail is set up (the two sections above), walk through this list once
after the first deploy (the same limit is in [Security](security.md#known-limitations)):

- **Cloudflare itself:** send a mail from outside to one of your addresses and see it arrive (Email Routing); send one from the app (Email Sending); turn notifications on in a
  browser and send yourself a mail (the real push service); send one mail with an attachment (real D1 and R2 limits); then look at the Worker's CPU time and the request cost in
  the dashboard.
- **Real https:** in the browser's developer tools check that the session cookie is named `__Host-edging_session`, that the page is answered with `Strict-Transport-Security`, that a
  wrong password is answered after about 400 ms or more, and that signing out on one device closes the live connection (`/api/ws`) of another device signed in as the same person.
- **Real Safari and iPhone:** open the app in Safari on an iPhone, add it to the Home Screen and turn notifications on from the installed app
  ([PWA and push](pwa-and-push.md#install-as-an-app-pwa)); to check the cryptography in Safari, run `npm run kat:browser` and open the page it builds
  ([Development](development.md#known-answer-tests-in-a-browser)).

## Rate limiting

The app throttles wrong passwords itself, but a check costs CPU for every request, also for an address that does not exist. Add a Cloudflare **rate-limiting rule** on your
zone (**Security → Security rules → Rate limiting rules**) for the paths `/api/auth/*` and `/api/admin/*`, for example 20 requests per minute per IP with the action
Block. Free zones have a limited number of rules; one rule on a path prefix is enough. The numbers are a starting point: a person signing in makes a handful of requests.
See [Security](security.md#brute-force-protection-and-cpu-cost).

## Updating

```bash
git pull
npm install
npm run db:migrate:remote    # only needed when drizzle/ gained a new migration; harmless otherwise
npm run deploy
```

`npm run deploy` rebuilds the client, applies pending migrations and runs `wrangler deploy`. Installed PWAs pick up the new version the next time they are brought to
the front. Migrations go first because the code reads the columns and tables they create. Read the release notes of a version that adds a **secret** before you deploy
it: the Worker needs it from the first request.

## Upgrading an existing single-user install

This applies to any install of the single-user version (one password, no accounts), whatever its age. **Set `DATA_KEY` before deploying this version**: without it the
new Worker answers `503` to every sign-in.

1. **Take a backup.** `npx wrangler d1 export edging_mail_db --remote --output backup.sql`. R2 objects are not changed by the migration; the cron writes new encrypted
   objects next to the old ones and never overwrites an old one. **You can go back until step 5:** restore the database and deploy the old code. From Setup on, the cron
   deletes each old object as soon as it has converted its row, so a restored database would point at objects that are gone. If you want a way back after that, copy
   the bucket first (for example `rclone sync`) as well. Everything in these copies is the old mail in plaintext: keep them only as long as you need the way back, and read
   what the conversion does not erase in step 6.
2. **Check the plan.** The whole install needs Workers Paid now (see [Prerequisites](#prerequisites)).
3. **Add the secrets.** Keep `JWT_SECRET` as it is: it also opens the old Web Push key once (step 5), and changing it before notifications were used after the upgrade makes every
   device turn them on again. Create `DATA_KEY` (`openssl rand -base64 32`, a different value from the other two) with
   `npx wrangler secret put DATA_KEY`. Keep `APP_PASSWORD`: it is no longer a sign-in password; it is the **setup key** for step 5. **If your `APP_PASSWORD` is shorter than 24 characters, replace it before upgrading**: the
   new Worker refuses a shorter setup key (Setup and break-glass answer `503`). One command makes a good one: `openssl rand -base64 24`, then `npx wrangler secret put APP_PASSWORD`.
4. **Deploy:** `git pull`, `npm install`, `npm run db:migrate:remote`, `npm run deploy`. Migration `0005_multi_user` adds the new tables and columns (among them `messages.origin`, `smtp` for every old
   mail) and touches no mail. Every old session stops working: the single-user cookie is not valid for the new version, and over https the session cookie now has another name
   (`__Host-edging_session`), which an old cookie never matches. Everybody signs in again once; nobody has to clear anything (a leftover cookie of the old name is removed at the next
   sign-in or sign-out).
5. **Run Setup.** Open the app. It shows Setup (no account exists yet). Enter the setup key, your address, a password of at least 16 characters, and write down the
   recovery key; enrol two-step verification. Setup gives **everything of the old install to this first admin** in one step: all mail, drafts, the push subscriptions,
   and the display name and signature saved in the old Settings (the old sender setting is dropped: everybody sends from their own address). The devices that had notifications
   on keep them: the old Web Push key is read with `JWT_SECRET` and sealed under `DATA_KEY` the first time push is needed (the next new mail will do). The admin console then
   lists your domain. The key is moved, not rotated: a D1 backup or Time Travel snapshot from before the upgrade still holds the private half sealed under the old `JWT_SECRET`, so
   whoever has that backup and that secret can open it. What it signs is only the push request (a message also needs each device's own keys), so the impact is small; if it matters
   to you, rotate the pair after the upgrade by deleting the one row of `push_keys` in D1: the next push makes a new pair and removes every device (they then turn notifications on again).
6. **Wait for the conversion.** Old mail is still plaintext in D1 and R2 until the cron has converted it. Once the admin has keys, the cron converts 25 rows a minute
   (`ENCRYPT_CHUNK_ROWS`), writing new encrypted objects first and flipping each row in one guarded step; a large archive takes hours. `GET /api/admin/health` (`plaintext_rows`) shows
   how many plaintext rows are left. Until it is zero, the claim that stored mail is encrypted does not hold for those rows. The conversion survives a crash at any point (a row is
   plaintext or encrypted, never half of each; a run that died holds the others off for at most four minutes). A crash between "row converted" and "old objects deleted" leaves a
   plaintext copy in R2 that no row points at: once no plaintext row is left, the cron removes every such object under the old prefixes (`raw/`, `sent/`, `attachments/`) and then stops
   looking. The whole path, from the old schema to the last object, is exercised by `test/upgrade.test.ts`. **The bucket must be dedicated to this app.** The sweep deletes every
   object under `raw/`, `sent/` and `attachments/` that no row points at, so a bucket shared with another application loses the objects that application keeps under those three
   prefixes at the end of the conversion. During the minutes of a deploy, an old version that writes `raw/<id>` just before it inserts the row could lose that object if the sweep ran
   in that window (theoretical: the sweep only runs once no plaintext row is left). **What the conversion does not erase.** Mail stored before the upgrade was plaintext. When the job is done (`plaintext_rows` is zero) that mail is encrypted in the live
   database and in R2, and no plaintext object is left in the bucket. Copies made **before** the job can still hold the plaintext: the export of step 1, a copy of the
   bucket, D1 Time Travel and the other backups the platform keeps (Cloudflare documents 30 days of Time Travel history on Workers Paid), and the free space inside the
   database file, where the bytes of an updated or deleted row can stay until the platform reuses them. D1 gives you no control over that file: we know of no supported way to
   vacuum it or to overwrite its free pages. The only way to be sure the plaintext is gone is to delete the export and the bucket copy you made and to let the platform's copies
   expire. This applies only to mail that existed before the upgrade: mail received after Setup is sealed when it arrives, and mail held for somebody without keys is sealed under
   `DATA_KEY`. What this version promises is that the app stores no plaintext any more and converts the old mail, not that no copy of it exists anywhere.
7. **Mail during the gap.** Mail that arrived after the deploy and before Setup is held without an owner, sealed under `DATA_KEY`, and handed to you at Setup. Only the
   address of an account (primary or alias) receives mail from now on: add aliases for any other address you used, or mail to it is rejected.
8. **Add people** in the admin console. Each gets a temporary password, chooses their own at first sign-in, gets their keys and a recovery key, and enrols
   two-step verification.

The old `DEFAULT_FROM` stays as the default sender of the Setup screen and as the contact of Web Push.

## Cost and plan notes

| Piece          | Plan note                                                                                                                   |
| -------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Worker         | **Workers Paid for the whole install**: a sign-in is about 40-50 ms of CPU, the Free limit is 10 ms per request             |
| D1, R2, Cron   | Each has an allowance; check current pricing for your volume. Cron Triggers: 5 per account on Workers Free; this app uses 1 |
| Durable Object | A SQLite-backed class (`new_sqlite_classes`), one object per account for realtime events                                    |
| Email Routing  | Free and unlimited inbound. On Workers Free the Email Worker can exceed the CPU limit on large mails                        |
| Email Sending  | Beta. Needs Workers Paid for arbitrary recipients; the daily quota starts low on new accounts                               |

Documentation checked on 7 November 2026. Cloudflare's products and limits change, so confirm the linked pages before you rely on a number.
