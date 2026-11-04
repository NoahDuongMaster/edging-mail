# Development

How to run, change and check Edging Mail on your machine. Nothing here touches your Cloudflare account: `wrangler dev` emulates D1, R2, Durable Objects and Email
Routing locally.

- [Prerequisites](#prerequisites)
- [Run it locally](#run-it-locally)
- [Frontend development](#frontend-development)
- [Receive a test email](#receive-a-test-email)
- [Database migrations](#database-migrations)
- [Testing the snooze cron](#testing-the-snooze-cron)
- [Checks: types, lint, format](#checks-types-lint-format)
- [Commit style](#commit-style)

## Prerequisites

- Node.js 24 or newer and npm. No `engines` field or `.nvmrc` pins a version; the lowest the toolchain allows is Node 22.15 (Wrangler 4 needs 22+, Vite 8 needs
  22.12+, and the ESLint setup uses `module.registerHooks`, added in 22.15).
- OpenSSL, or any other way to produce a random password and key (optional).

## Run it locally

```bash
git clone https://github.com/NoahDuongMaster/edging-mail.git
cd edging-mail
npm install
cp .dev.vars.example .dev.vars    # then replace APP_PASSWORD and JWT_SECRET, see below
npm run db:migrate:local          # create the local D1 schema
npm run build                     # Wrangler needs dist/client to exist
npm run worker:dev                # http://localhost:8787
```

`.dev.vars` is gitignored. `APP_PASSWORD` needs at least 12 characters and `JWT_SECRET` at least 32; the placeholders are too short on purpose, so login answers
`503 Login is not configured` until you replace them (`openssl rand -base64 24` and `openssl rand -hex 32` make good values). All variables are described in
[Configuration](configuration.md). Instead of a file you can pass values on the command line:

```bash
npm run worker:dev -- --var APP_PASSWORD:"a-long-random-password" --var JWT_SECRET:"$(openssl rand -hex 32)"
```

Open `http://localhost:8787` and sign in. Local D1 and R2 data live in `.wrangler/state` (gitignored); deleting that directory resets them.

`wrangler.jsonc` sets `dev.host` to `localhost`. Without it, `wrangler dev` tells the Worker its URL is the hostname from `routes`, and the WebSocket `Origin`
check then refuses the Vite dev server.

## Frontend development

For hot reloading, keep the Worker running and start Vite next to it:

```bash
npm run worker:dev    # terminal 1, port 8787
npm run dev           # terminal 2, Vite on http://localhost:3000
```

Vite proxies `/api` (including the WebSocket) to `http://localhost:8787` (`vite.config.ts`). The service worker is registered in production builds only, so the dev
server never serves a stale app shell. To try the installable PWA, use `npm run build` and `npm run worker:dev`.

## Receive a test email

There is no mock inbox. Mail enters through the same `email()` handler that Email Routing calls in production. `wrangler dev` exposes it at
`/cdn-cgi/handler/email`; post a real MIME message to it. This endpoint is not an `/api` route, so no login is needed locally.

```bash
cat > hello.eml <<'EOF'
From: Alice <alice@example.org>
To: you@example.com
Subject: Hello from a real MIME message
Message-ID: <hello-1@example.org>
Content-Type: text/plain; charset=utf-8

Hi! This goes through the same parser and storage as production mail.
EOF

curl -X POST "http://localhost:8787/cdn-cgi/handler/email?from=alice@example.org&to=you@example.com" --data-binary @hello.eml
```

The mail shows up in the Inbox. Build the `.eml` with whatever you like (an HTML part, attachments, `In-Reply-To` to test threading, non-ASCII subjects): the parser
sees it exactly as it would from Email Routing. Its `In-Reply-To` and `References` are stored, and its `Date` header becomes the mail's date unless that is missing,
invalid or in the future (see [Mail features](mail-features.md#lists-threads-search-and-stats)).

Sending is simulated locally: see [Sending while developing](mail-features.md#sending-while-developing).

## Database migrations

The D1 schema is defined with [Drizzle ORM](https://orm.drizzle.team) in `src/worker/db/schema.ts`. SQL migrations live in `drizzle/` and are applied by Wrangler
(`migrations_dir` in `wrangler.jsonc`), which records what it has run in the database's `d1_migrations` table.

| Command                     | What it does                                                                        |
| --------------------------- | ----------------------------------------------------------------------------------- |
| `npm run db:migrate:local`  | `wrangler d1 migrations apply DB --local`: apply pending migrations to the local D1 |
| `npm run db:migrate:remote` | `wrangler d1 migrations apply DB --remote`: same for the production D1              |
| `npm run db:generate`       | `drizzle-kit generate`: write a new migration from the changes in `schema.ts`       |

**Changing the schema:** edit `src/worker/db/schema.ts`, run `npm run db:generate`, review the new `drizzle/NNNN_*.sql`, then `npm run db:migrate:local` and later
`npm run db:migrate:remote`. Commit the whole `drizzle/` folder, including `drizzle/meta/`: `drizzle-kit` diffs against it.

Applying migrations is safe to repeat: Wrangler skips the ones already applied. The baseline `drizzle/0000_init.sql` is hand-edited (`CREATE ... IF NOT EXISTS`,
`INSERT OR IGNORE` for the default settings), so it is also a no-op on a database that was created earlier from the old `schema.sql` (removed; the migrations replace
it). Don't regenerate it. Migration `0001` additionally removes the demo settings that `0000` used to seed, but only rows that still hold the exact seed value.

Run a query against the local database with `npx wrangler d1 execute DB --local --command "SELECT folder, count(*) FROM messages GROUP BY folder"`.

### Legacy databases

A database created from the very first version of `schema.sql` has no `messages.labels` column. For such a database `db:migrate:*` stops with
`no such column: labels` (nothing is recorded). Add the column once, then run the migration again:

```bash
npx wrangler d1 execute DB --local --command "ALTER TABLE messages ADD COLUMN labels TEXT NOT NULL DEFAULT '[]'"   # --remote for production
npm run db:migrate:local                                                                                           # or db:migrate:remote
```

If the column already exists, the `ALTER` fails with `duplicate column name: labels`, which is harmless.

## Testing the snooze cron

Start the dev server with `--test-scheduled`, then call Wrangler's scheduled endpoint:

```bash
npm run worker:dev -- --test-scheduled
curl "http://localhost:8787/cdn-cgi/handler/scheduled"
```

To get a mail that is already due, snooze one for a minute in the app and trigger after it elapsed, or set the row directly in the local database (the API refuses a
time in the past):

```bash
npx wrangler d1 execute DB --local --command "UPDATE messages SET folder='snoozed', snoozed_until=$(node -p 'Date.now() - 1000') WHERE id='<message id>'"
```

The trigger answers `ok`; the mail is then back in the Inbox, unread. Run it again and nothing happens.

## Checks: types, lint, format

```bash
npm run check    # tsc -b && npm run lint && npm run format:check
```

| Script                 | What it runs                                                                  |
| ---------------------- | ----------------------------------------------------------------------------- |
| `npm run build`        | `tsc -b && vite build`: type-check, then bundle the client into `dist/client` |
| `npm run lint`         | `eslint .`                                                                    |
| `npm run lint:fix`     | `eslint . --fix`                                                              |
| `npm run format`       | `prettier --write .`                                                          |
| `npm run format:check` | `prettier --check .`                                                          |

- **Types:** TypeScript 7 (`tsc`), strict mode. The Worker and the client share one `tsconfig.json`.
- **Lint:** ESLint 9 flat config with `typescript-eslint` `strictTypeChecked` and `stylisticTypeChecked`, plus React, React Hooks, jsx-a11y, import-x and unicorn
  rules. typescript-eslint cannot use the TypeScript 7 compiler API yet, so `eslint-typescript6-hook.js` points it at `@typescript/typescript6` (a lint-only dev
  dependency); remove the hook once typescript-eslint supports TypeScript 7.1 or newer. Unused `eslint-disable` comments are errors, so a disable must be justified in a
  comment next to it.
- **Format:** Prettier (`.prettierrc.json`: 140 columns, single quotes, semicolons, no trailing commas, LF). It also checks Markdown. `drizzle/`, `public/` and `*.sql`
  are ignored.

There is no automated test suite yet. `npm run check` is the gate, and a manual pass in `npm run worker:dev` covers behaviour. Tests are a welcome contribution.

## Commit style

Commits follow [Conventional Commits](https://www.conventionalcommits.org/), as in the history: `feat: …`, `fix: …`, `refactor: …`, `chore: …`, `docs: …`. Keep the
subject short and in the imperative, and say why in the body when it is not obvious. See [CONTRIBUTING.md](../CONTRIBUTING.md) for the full workflow.
