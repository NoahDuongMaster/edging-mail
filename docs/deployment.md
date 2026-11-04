# Deployment

Edging Mail runs as one Worker on a Custom Domain of your own, with a D1 database, an R2 bucket, a Durable Object and a Cron Trigger. Every command on this page
changes your real Cloudflare account: run them yourself, in this order.

Hostnames below are placeholders: `mail.example.com` is the app, `example.com` is your domain. The maintainer's own deployment (`mail.duongnamtruong.com`,
`hi@duongnamtruong.com`) is only an example of one working setup.

- [Prerequisites](#prerequisites)
- [1. Make the repository yours](#1-make-the-repository-yours)
- [2. Create the D1 database and the R2 bucket](#2-create-the-d1-database-and-the-r2-bucket)
- [3. Apply the migrations](#3-apply-the-migrations)
- [4. Secrets](#4-secrets)
- [5. Deploy](#5-deploy)
- [Receive mail (Email Routing)](#receive-mail-email-routing)
- [Send mail from your domain](#send-mail-from-your-domain)
- [Updating](#updating)
- [Cost and plan notes](#cost-and-plan-notes)

## Prerequisites

- A Cloudflare account with a domain whose DNS is on Cloudflare (the zone must be active).
- Node.js 24 or newer and npm. No `engines` field or `.nvmrc` pins a version; the lowest the toolchain allows is Node 22.15 (Wrangler 4 needs 22+, Vite 8 needs 22.12+,
  and the ESLint setup uses `module.registerHooks`, added in 22.15).
- Wrangler signed in to your account: `npx wrangler login`.
- For sending to arbitrary recipients: the Workers Paid plan. Email Sending is in beta. Receiving through Email Routing is free.

## 1. Make the repository yours

Fork and clone the repository, then edit `wrangler.jsonc`: replace the route, the D1 id and `DEFAULT_FROM`. The table with every value is in
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

If you choose other names, change `database_name` and `bucket_name` in `wrangler.jsonc` to match.

## 3. Apply the migrations

```bash
npm run db:migrate:remote
```

It is safe to repeat: Wrangler skips migrations it has already applied. Migration `0004_push_keys` creates the table where Web Push keeps its key pair.

**Deploying with Workers Builds (Git push):** to migrate and deploy on every push, do two things once in the Cloudflare dashboard. First, add **Account → D1 → Edit**
to the build's API token: the token Cloudflare creates by default has no D1 permission (Workers Scripts, KV, R2 and Routes only, see
[Builds configuration](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/#api-token)), so without it a build can neither create the database
nor run migrations. Second, set **Settings → Builds → Deploy command** to `npm run db:migrate:remote && npx wrangler deploy`. The migration step runs before the
deploy, and Wrangler skips migrations it has already applied, so it is safe on every push. If you would rather not give the build token D1 access, do steps 2 and 3
from your own machine and run `npm run db:migrate:remote` again before you push a change that adds a `drizzle/NNNN_*.sql` file.

## 4. Secrets

The two secrets are stored with Wrangler. `APP_NAME` and `DEFAULT_FROM` are plain `vars` in `wrangler.jsonc`.

```bash
npx wrangler secret put APP_PASSWORD         # at least 12 characters
npx wrangler secret put JWT_SECRET           # at least 32 characters
```

The Worker does not exist before the first deploy, so the first `secret put` asks "Do you want to create a new Worker with that name and add secrets to it?":
answer yes. That prompt comes from Wrangler itself. The deploy in step 5 replaces the empty Worker and keeps the secrets. Alternative: `npx wrangler deploy
--secrets-file <json file>` uploads secrets together with the code ([Secrets](https://developers.cloudflare.com/workers/configuration/secrets/)).

Until `APP_PASSWORD` and `JWT_SECRET` exist, login answers `503` and nothing else is reachable. Web Push needs nothing else: the Worker creates its own key pair when
notifications are first turned on ([Web Push keys](configuration.md#web-push-keys)). Because that key is sealed with `JWT_SECRET`, changing `JWT_SECRET` later resets
push and every device has to turn notifications on again.

## 5. Deploy

```bash
npm run deploy    # npm run build, apply the migrations, then wrangler deploy
```

Open `https://mail.example.com` and sign in. In the dashboard, **Workers & Pages → edging-mail → Settings → Domains & Routes** should list only your hostname. A new
Cron Trigger can take up to 15 minutes to propagate, so snoozed mail may not return during the first minutes
([Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/)).

## Receive mail (Email Routing)

Inbound mail reaches the app only through Email Routing, which calls the Worker's `email()` handler. Deploy the Worker first: a routing rule can only point at an
existing Worker.

### Option A: Email Routing on your domain

Use this when the domain has no other mail host, or when you are willing to give that mailbox up.

1. **Compute → Email Service → Email Routing → Onboard Domain**, choose `example.com`. Cloudflare adds MX, SPF and DKIM records on the root domain
   ([domain configuration](https://developers.cloudflare.com/email-service/configuration/domains/)). Cloudflare requires MX records of a previous provider to be removed
   first, so that provider stops receiving mail for the domain.
2. **Routing Rules → Create routing rule**: address `you` on `example.com`, action **Send to a Worker**, destination `edging-mail`. A catch-all rule can send every
   address of the domain to the Worker instead ([routing rules](https://developers.cloudflare.com/email-service/configuration/email-routing-addresses/)).
3. Send a test mail from another account. It shows up in the Inbox.

### Option B: mail hosted elsewhere (forward to a subdomain)

Use this when the root MX records must stay with another provider. Email Routing can run on a subdomain, and the other provider forwards one address to it. This is how
the maintainer runs it: `hi@duongnamtruong.com` is a Proton mailbox, forwarded to an address on `mail.duongnamtruong.com`, which Email Routing hands to the Worker.

```
you@example.com (other provider) ── forwarding rule ──▶ inbox@mail.example.com (Email Routing) ──▶ this Worker
```

Onboarding Email Routing on a domain whose MX belongs to another provider fails with error 2008 ("Non-Cloudflare MX records exist"), and replacing those records would
stop that provider from receiving mail ([moving to Email Routing](https://developers.cloudflare.com/email-service/configuration/domains/#move-to-email-routing-from-another-provider)).

**a. Email Routing on the subdomain** ([subdomains](https://developers.cloudflare.com/email-service/configuration/subdomains/)).

1. **Compute → Email Service → Email Routing**, select `example.com`, open **Settings**, and under **Subdomains** add `mail.example.com`. Cloudflare adds the DNS
   records to that subdomain; the root MX stays where it is.
2. **Routing Rules → Create routing rule**: address `inbox` on `mail.example.com`, action **Send to a Worker**, destination `edging-mail`. Catch-all rules exist only for
   the apex domain, so every address on the subdomain is a literal rule.
3. Check: `dig +short MX mail.example.com` lists Cloudflare's servers and `dig +short MX example.com` still lists the old provider. A mail sent to
   `inbox@mail.example.com` from any account shows up in the Inbox.

**b. Forwarding rule at the other provider.** For Proton ([Proton: email forwarding](https://proton.me/support/email-forwarding)):

1. In Proton: **Settings → All settings → Forward and auto-reply → Add forwarding rule**. Forward from `you@example.com` to `inbox@mail.example.com`, no condition, then
   **Send confirmation email**.
2. Proton sends a confirmation message to the destination address and the rule stays inactive until it is accepted. That message arrives in the app's Inbox: open it and
   click **Accept forwarding**. If the button does not open from the app, the link is also in the raw message (`GET /api/raw/:id`).
3. Forwarding is available on Proton Mail Plus, Proton Unlimited and the other paid Proton Mail plans. Forwarding to a non-Proton address turns off end-to-end
   encryption for the forwarded address, and a forwarded mail cannot be forwarded again.
4. Send a test mail to `you@example.com` from another provider: it appears in the Inbox.

**Not confirmed by the docs** (check on your first test): that Cloudflare accepts a Custom Domain and MX records on the same hostname (the docs only forbid a CNAME
there; if it refuses, route inbound mail on another subdomain such as `in.example.com`); the exact DNS records added to a routing subdomain; how the other provider
re-sends forwarded mail (Email Routing validates DMARC and records the result in `Authentication-Results`, but the docs do not say what happens on a failure, so try a
sender with a strict DMARC policy); and the Proton confirmation flow itself, which the maintainer has not run end to end.

### Option C: move the root MX to Cloudflare

Enable Email Routing on the root domain and route the address to the Worker, as in Option A. Cloudflare requires the old provider's MX records to be removed first, so
that provider **stops receiving mail** for the domain: only do this if you give up that mailbox. The forwarding rule from Option B is then unnecessary.

## Send mail from your domain

Email Sending is in beta, and sending to arbitrary recipients needs the **Workers Paid** plan ([pricing](https://developers.cloudflare.com/email-service/platform/pricing/)).

1. In the dashboard: **Compute → Email Service → Email Sending → Onboard Domain**, choose `example.com`
   ([domain configuration](https://developers.cloudflare.com/email-service/configuration/domains/)).
2. Cloudflare adds MX records and an SPF TXT on `cf-bounce.example.com`, a DKIM TXT on `cf-bounce._domainkey.example.com` and a DMARC TXT on `_dmarc.example.com`.
   Review them in the dialog before you accept.
3. If another provider hosts the mail of the root domain:
   - **Do not touch the MX records** of `example.com`; they stay where they are.
   - **SPF:** a name may carry only one SPF record. The sending SPF is on `cf-bounce.`, so the root record needs no change. If the dashboard ever asks for an SPF entry
     on the root, merge it into the existing record instead of adding a second one, for example
     `v=spf1 include:_spf.protonmail.ch include:_spf.mx.cloudflare.net ~all` (SPF allows 10 DNS lookups in total).
   - **DMARC:** a domain may carry only one DMARC record. What the onboarding does with an existing one is not documented: check in the dashboard, and afterwards
     `dig +short TXT _dmarc.example.com` must still show exactly one `v=DMARC1` record.
   - Leave the other provider's DKIM records alone: DKIM selectors have different names and do not conflict (Cloudflare's sending selector is `cf-bounce`).
4. Wait 5-15 minutes, then check the records under **Email Sending → Settings**. Until the domain is onboarded you can only send to verified destination addresses of
   the account.
5. Set the sender in the app (**Settings → Sender address**) or as `DEFAULT_FROM`. It must be an address on the onboarded domain.

Replies leave as your address, sent through Cloudflare Email Sending and not through the other provider. They do not appear in that provider's Sent folder, and an
answer to your reply goes to your address at the root domain, so to the other provider and, through the forwarding rule, to the app.

## Updating

```bash
git pull
npm install
npm run db:migrate:remote    # only needed when drizzle/ gained a new migration; harmless otherwise
npm run deploy
```

`npm run deploy` rebuilds the client, applies pending migrations and runs `wrangler deploy`. Installed PWAs pick up the new version the next time they are brought to the front. Migrations
go first because push reads its key pair from the `push_keys` table, which migration `0004_push_keys` creates.

## Cost and plan notes

| Piece                | Plan note                                                                                                                       |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Worker, D1, R2, Cron | Each has a free allowance; check current pricing for your volume. Cron Triggers: 5 per account on Workers Free; this app uses 1 |
| Durable Object       | A SQLite-backed class (`new_sqlite_classes`), the only kind the Workers Free plan allows                                        |
| Email Routing        | Free and unlimited inbound. On Workers Free the Email Worker can exceed the CPU limit on large mails                            |
| Email Sending        | Beta. Needs Workers Paid for arbitrary recipients; the daily quota starts low on new accounts                                   |

Documentation checked on 4 November 2026. Cloudflare's products and limits change, so confirm the linked pages before you rely on a number.
