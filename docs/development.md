# Development

How to run, change and check Edging Mail on your machine. Nothing here touches your Cloudflare account: `wrangler dev` emulates D1, R2, Durable Objects and Email
Routing locally.

- [Prerequisites](#prerequisites)
- [Run it locally](#run-it-locally)
- [Frontend development](#frontend-development)
- [Receive a test email](#receive-a-test-email)
- [Database migrations](#database-migrations)
- [Running the cron by hand](#running-the-cron-by-hand)
- [Checks: types, lint, format, bundle](#checks-types-lint-format-bundle)
- [Tests](#tests)
- [Known-answer tests in a browser](#known-answer-tests-in-a-browser)
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
cp .dev.vars.example .dev.vars    # then replace APP_PASSWORD, JWT_SECRET and DATA_KEY, see below
npm run db:migrate:local          # create the local D1 schema
npm run build                     # Wrangler needs dist/client to exist
npm run worker:dev                # http://localhost:8787
```

`.dev.vars` is gitignored. `APP_PASSWORD` (the setup key) needs at least 24 characters, `JWT_SECRET` at least 32 and `DATA_KEY` must be the base64 of 32 random bytes; the three must
differ. The placeholders are unusable on purpose, so sign-in and Setup answer `503 Server is not configured` until you replace them (`openssl rand -base64 24`,
`openssl rand -hex 32` and `openssl rand -base64 32` make good values). All variables are described in [Configuration](configuration.md). Instead of a file you can pass
values on the command line:

```bash
npm run worker:dev -- --var APP_PASSWORD:"a-long-random-setup-key" --var JWT_SECRET:"$(openssl rand -hex 32)" --var DATA_KEY:"$(openssl rand -base64 32)"
```

Open `http://localhost:8787`. A fresh local database shows the **Setup** screen: enter the setup key (`APP_PASSWORD`), an address on a domain you choose (for example
`you@example.com`, which becomes the first admin and the first domain), a password of at least 16 characters, write down the recovery key and enrol two-step verification
with any authenticator app. Local D1 and R2 data live in `.wrangler/state` (gitignored); deleting that directory resets them, and Setup runs again.

To try Web Push against a fake push service on loopback, add `ALLOW_LOCAL_PUSH=on` to `.dev.vars` (the tests set it themselves); without it only real push services over https are accepted.

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

Every text the app shows lives in a language catalogue, and the languages come from one list. How texts are written, translated and checked, and how to add a language, is in
[Languages (i18n)](i18n.md).

## Receive a test email

There is no mock inbox. Mail enters through the same `email()` handler that Email Routing calls in production. `wrangler dev` exposes it at
`/cdn-cgi/handler/email`; post a real MIME message to it. This endpoint is not an `/api` route, so no sign-in is needed locally. The recipient must be an address of an
account (the first admin's primary address, or an alias an admin added); any other recipient is rejected with `Unknown recipient`. Mail posted before Setup is held
without an owner and handed to the first admin when Setup completes.

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

The mail shows up in the Inbox, stored encrypted to the account's key (the browser opens it). Build the `.eml` with whatever you like (an HTML part, attachments,
`In-Reply-To` to test threading, non-ASCII subjects): the parser sees it exactly as it would from Email Routing. Its `In-Reply-To` and `References` are stored, and its
`Date` header becomes the mail's date unless that is missing, invalid or in the future (see [Mail features](mail-features.md#lists-threads-search-and-stats)).

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

Migration `0005_multi_user` first ships with the first release of the multi-user version, so until that commit it may still be edited in place. From that commit on, a schema
change is a new migration (`0006` and so on), never an edit of one that a database may already have applied.

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

## Running the cron by hand

The Cron Trigger runs `scheduled()` every minute, and one pass starts four jobs: return due snoozed mail to the Inbox, seal pending mail to owners who have keys, convert old
plaintext mail to the encrypted format, and apply due two-step resets of admins (plus, once an hour, pruning old sign-in records). Start the dev server with
`--test-scheduled`, then call Wrangler's scheduled endpoint to run one pass:

```bash
npm run worker:dev -- --test-scheduled
curl "http://localhost:8787/cdn-cgi/handler/scheduled"
```

To get a mail that is already due, snooze one for a minute in the app and trigger after it elapsed, or set the row directly in the local database (the API refuses a
time in the past):

```bash
npx wrangler d1 execute DB --local --command "UPDATE messages SET folder='snoozed', snoozed_until=$(node -p 'Date.now() - 1000') WHERE id='<message id>'"
```

The trigger answers `ok`; the mail is then back in the Inbox, unread. Run it again and nothing happens. The conversion of legacy plaintext mail does at most
`ENCRYPT_CHUNK_ROWS` rows (default 25) per pass, so a larger archive needs several passes.

## Checks: types, lint, format, bundle

```bash
npm run check    # tsc -b && npm run lint && npm run format:check && npm run check:bundle
```

| Script                 | What it runs                                                                                                                                                            |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run build`        | `tsc -b && vite build`: type-check, then bundle the client into `dist/client`                                                                                           |
| `npm run lint`         | `eslint .`                                                                                                                                                              |
| `npm run lint:fix`     | `eslint . --fix`                                                                                                                                                        |
| `npm run format`       | `prettier --write .`                                                                                                                                                    |
| `npm run format:check` | `prettier --check .`                                                                                                                                                    |
| `npm run check:bundle` | Builds the Worker the way a deploy does and fails if a module of ours can open mail (HPKE open, private-key import, ECDH) or calls an unreviewed `crypto.subtle` method |
| `npm test`             | `vitest run`: the test suite, see [Tests](#tests)                                                                                                                       |
| `npm run kat:browser`  | Builds `dist/kat/index.html`, the known-answer tests as a page for a browser, see [below](#known-answer-tests-in-a-browser)                                             |

- **Types:** TypeScript 7 (`tsc`), strict mode. The Worker and the client share one `tsconfig.json`.
- **Lint:** ESLint 9 flat config with `typescript-eslint` `strictTypeChecked` and `stylisticTypeChecked`, plus React, React Hooks, jsx-a11y, import-x and unicorn
  rules. typescript-eslint cannot use the TypeScript 7 compiler API yet, so `eslint-typescript6-hook.js` points it at `@typescript/typescript6` (a lint-only dev
  dependency); remove the hook once typescript-eslint supports TypeScript 7.1 or newer. Unused `eslint-disable` comments are errors, so a disable must be justified in a
  comment next to it.
- **Format:** Prettier (`.prettierrc.json`: 140 columns, single quotes, semicolons, no trailing commas, LF). It also checks Markdown. `drizzle/`, `public/` and `*.sql`
  are ignored.
- **Bundle guard:** `check:bundle` catches accidents, not a determined contributor. Of 25 deliberately rogue variants it caught 21; a computed property name and `new Function`
  get past it, and a scan of the bundle cannot see inside a library. Code review of `src/worker` stays the control.

## Tests

```bash
npm test    # vitest run
```

`npm test` needs no `.dev.vars`, no `.wrangler` state, no `dist/client`, no Cloudflare account and no network (tests that reach for DNS or a push service
stub `fetch`). It has two projects, set up in `vitest.config.ts`:

- **`worker`** runs the real Worker (`src/worker/index.ts`) inside workerd with a real D1 database that has every migration of `drizzle/` applied, real R2 and the real
  `MailHub` Durable Object (`@cloudflare/vitest-plugin`). There is deliberately no wrangler config file in the test setup, because Wrangler loads `.dev.vars` from the
  folder of the config it is given; every binding and the secrets (fixed test values) are declared in `vitest.config.ts`. Every test starts from an empty database and
  bucket (`test/setup.ts`), and files run one after the other, so tests never depend on each other.
- **`static`** (`test/static/`) runs in Node because it reads the source tree: the error-code registry against the client catalogue, and similar consistency checks.

Run one file with `npx vitest run --project worker test/auth.test.ts`. `test/helpers.ts` has the helpers (create a user with keys, sign in, call the API, fake a push
service). The route tables are tested: `test/gate.test.ts` fails for a route nobody classified as public or private, and `test/admin-p1.test.ts` fails for an admin route
that accepts a password or a key. `test/crypto/` holds the known-answer tests against `vectors.json`, `vectors-v4.json` and the CFRG vector. Three tests keep the documents honest:
`test/docs-api.test.ts` fails when a route or an error code is missing from `docs/api.md` (or documented but not there), `test/static/docs-config.test.ts` when a binding or variable of
`Env` is missing from `docs/configuration.md`, and `test/static/notice.test.ts` when a runtime dependency is missing from `NOTICE` or its version or licence differs from `package-lock.json`.

A full run takes about five to seven minutes and a lot of memory (workerd and the TypeScript checker together); run it on its own. `npm run check` is the other half of the gate.

## Known-answer tests in a browser

The known-answer tests (`test/crypto/kat.test.ts`: HPKE, the password KDF, the private-key wraps, the EM1 envelope, the recovery-key codec and the verifier) run on the
Workers runtime in `npm test`. Browser engines implement WebCrypto themselves, so the same tests should run there too:

```bash
npm run kat:browser    # writes dist/kat/index.html
```

`scripts/kat-browser.mjs` bundles the same test file with esbuild, with a small stand-in for the few Vitest functions it uses (`test/crypto/browser-shim.ts`), into one
self-contained page. Open `dist/kat/index.html` in each engine you want to check (Chrome, Firefox, Safari, a phone): the page title and its last line say
`PASS: all N tests` or `FAIL: …`, one line per test says which, and `<body data-result="pass|fail">` carries the verdict for a script. WebCrypto needs a secure context;
`file://` works in current engines, and if yours refuses, serve the folder from localhost (`python3 -m http.server --bind 127.0.0.1 --directory dist/kat 8000`). The page
does the 600,000-iteration key derivation several times, so give a slow device up to a minute. The same bundle has been run under Node's WebCrypto (all tests passed, and
a deliberately broken expectation was reported as a failure); a run in real browser engines is still to be done.

## The mail frame in a browser

The frame that shows an HTML mail (`MailFrame.tsx`, with the document built by `src/client/lib/mailDocument.ts`) must let nothing reach the network until the reader
presses Show images, and even then only pictures. It has two lines of defence and the probe tests both: the policy of the frame (a `<meta>` Content-Security-Policy), and the
document itself, which names no address of another host while images are off. The second line is there because a browser does not always apply the first: Firefox fetches
`srcset` and `<picture>` images when the mail is opened whatever the policy says, so no class of request relies on the policy alone. The same goes for the tree that was checked:
the frame parses the TEXT of the built document, and markup can be read differently the second time (a `<link>` that is text in the first reading is an element in the second), so
the document is read back from its own text and made safe again until the text stops changing (`src/client/lib/mailSettle.ts`; four passes at most, then an empty document). Unit
tests cannot show what a browser does with a hostile mail, so a script puts 90 of them through the real function and the real sandbox, in a real browser, against a fake tracker:

```bash
node scripts/frame-probe.mjs             # serves http://127.0.0.1:8801/ and prints the address; open it in any browser on this machine
node scripts/frame-probe.mjs --wait      # the same, then exit 0 (all passed) or 1 (a probe failed) when a page has reported; 2 if none did
node scripts/frame-probe.mjs --control   # the same with the protection OFF: it must show leaks (exit 0), otherwise the probe is blind (exit 1); see "The control run, per engine"
```

It adds no dependency (like `kat-browser.mjs` it uses the esbuild of this repo) and `package.json` has no entry for it. The page runs the probes one after the other, about
a minute in all, after a harmless warm-up probe: images (`img`, `srcset`, `sizes`, `picture`, addresses hidden with a tab or a backslash, CSS `url()`, `image-set`, masks,
cursors), `<link>` of every kind (`stylesheet`, `prefetch`, `preload`, `preconnect`, `prerender`, `modulepreload`, `dns-prefetch`, in the head and in the body), `<base>`,
`<meta http-equiv="refresh">`, speculation rules, media, `object`, `embed`, nested frames, forms, SVG pictures, `data-*` attributes, scripts and event handlers, markup that the
parser reads differently the second time (a form, MathML and a `<style>` that turn a later `<link>` or `srcset` into an element: 14 probes, four of which leaked in browsers before the
rebuild), and seven links
that need a click (a `ping` attribute, a `javascript:` and a `data:` link, a plain link). Each one lives in a sandboxed `srcdoc` iframe with the `sandbox` value read from
`MailFrame.tsx`.

**What passes.** A probe passes when nothing reached the tracker (no request, and no bare connection, which is what `preconnect` makes), no script ran, and the built document
has no `<link>`, no `<base href>`, no `ping`, no speculation rules and no address of another host (the page counts them with code of its own: every attribute whose value
names a host, but the target of a link and the words of `alt` or `title`, every `srcset` and `sizes`, every remote `url()`, `@import` or `image-set` string of a style), and
starts with `x-dns-prefetch-control: off`. Beside the probes, rows named `check-…` test the same document with images ALLOWED: every picture address, `srcset` and remote
style is kept, the policy lets `data:` and `https:` pictures through, the reader is told that the mail has pictures, and the target of a link is kept while images are off.
The verdict table is printed in the terminal and shown on the page: `<main data-result="pass|fail">`, and the same on every row.

**Notes, which are not failures.** A bare connection to the tracker with no request, for the probes `img` and `iframe`, is listed as a note: some browsers open a speculative
connection for these before they look at the policy. Nothing is asked for or sent, and the built document names no address (that is checked first), so there is nothing left
to remove. Any other bare connection, `preconnect` above all, fails. A request for `/favicon.ico` is not counted: a browser asks for it for the window of a link that was followed
on purpose. Any other request without the id of a probe in its path fails the row `(unattributed)`, and is never given to the probe that happened to come last.

**The control run, per engine.** `--control` must show leaks, and what it must see leak depends on what the engine does. The canaries are `img`, `css-bg` and `link-stylesheet`
in every engine, and `link-prerender` only in Chromium: Firefox does not act on `<link rel="prerender">` (seen in real runs; WebKit is taken not to, and has not been run), so there it can never leak, and a control run there that
leaked the other three is **CONTROL OK**, not blind. A control run in which an expected canary does not leak, or none does, is CONTROL BLIND (exit 1), and the summary says which
canaries it expected and which leaked, for which engine. The engine is read from the user agent of the page; `--engine=chromium|firefox|webkit` says it when the user agent
cannot. The consequence for the normal run, said plainly: **a pass on the prerender rows in Firefox proves nothing about the network**, because the engine would not fetch such a
link even from a raw mail. Those rows (`link-prerender*`, and the mutation probes whose payload is a prerender link, `mxss-form-math` and `mxss-fm-link-prerender` among them)
pass there with a note that says so; what checks them in Firefox is the document check (no `<link>`, no remote address in the text the frame parses) and the probes that use
`srcset`, `mxss-fm-img-srcset` and `mxss-fm-picture`, which Firefox does fetch. In Chromium those rows are meaningful on the network too.

**Clicks.** A link that needs a click shows `manual` until it has leaked (fail) or has been clicked (pass). Click it after the table has appeared (the iframe's `title` is the id of
the probe and the link has the id `l`), then say so: press the button under the frame, or call `window.__probeClicked('click-ping')` on the page, or send `POST /clicked/click-ping`
to the server. `/result.json` shows the state at any moment, so a driver can click the links and read it. A link a person follows on purpose opens the sender's address in a new
window and must send no referrer; if it was reported as clicked but the address was never requested, it stays `manual` (the new window may have been blocked).
A run is one run: once the page has reported, the server no longer moves the current probe, the first report cannot be replaced, and a second window of the page (a reload, a
link that opened it) runs no probe and shows the finished table. Start the script again for a new run.

The page is served with the policy of `public/_headers`, with one change that matters: the address of the tracker is added to the fetch directives. A `srcdoc` frame inherits
the policy of its parent, and that policy allows `https:` images only, so an `http` tracker on localhost would be stopped by the parent and the frame's own policy would never be
tested. The tracker listens on `127.0.0.1` and answers 404 to everything. The first run in Chromium and in Firefox found the `srcset` case above, which is why the document rule exists;
WebKit (Safari) has not been run. A change to `mailDocument.ts`, `mailUrls.ts`, `MailFrame.tsx` or the policy in `public/_headers` should be followed by a run in at least Chromium and
Firefox. Style sheets are rewritten by pattern, not parsed: an address hidden behind a CSS escape is not seen by the rewrite, and the policy stays the gate for it.

## Accessibility notes

Text sizes in the app are fixed pixel sizes, so the browser's default text-size setting is not honoured; page zoom and pinch zoom work. Moving about 200 sizes to `rem`
has not been done (known limit).

## Commit style

Commits follow [Conventional Commits](https://www.conventionalcommits.org/), as in the history: `feat: …`, `fix: …`, `refactor: …`, `chore: …`, `docs: …`. Keep the
subject short and in the imperative, and say why in the body when it is not obvious. See [CONTRIBUTING.md](../CONTRIBUTING.md) for the full workflow.
