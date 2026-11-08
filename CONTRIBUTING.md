# Contributing to Edging Mail

Thanks for helping. This is a small project, so the process is light: open an issue or a pull request, keep `npm run check` and `npm test` green, and keep the change
focused.

## Before you start

- **Bugs and small fixes:** open a pull request directly.
- **New features or anything that changes behaviour:** open an issue first and describe the problem you want solved. Edging Mail serves the people of one deployment, and
  its promise is that only the owner of a mailbox can read it: features that would let an admin, the server or a shared mailbox read other people's mail are out of scope.
- **Security problems:** do not open a public issue. Use **Security → Report a vulnerability** on the repository page (see [docs/security.md](docs/security.md)).

## Set up

You need Node.js 24 or newer and npm. You do not need a Cloudflare account: `wrangler dev` emulates D1, R2 and Durable Objects locally.

```bash
git clone https://github.com/<your-fork>/edging-mail.git
cd edging-mail
npm install
cp .dev.vars.example .dev.vars    # set APP_PASSWORD (24+ characters), JWT_SECRET (32+ characters) and DATA_KEY (openssl rand -base64 32)
npm run db:migrate:local
npm run build
npm run worker:dev                # http://localhost:8787
```

For hot reload on the client, run `npm run dev` next to `npm run worker:dev`. How to feed the local inbox a real MIME message, run the cron by hand, run the tests and work
with migrations is in [docs/development.md](docs/development.md).

## Before you open a pull request

```bash
npm run check    # tsc -b && eslint . && prettier --check . && the Worker bundle guard
npm test         # the test suite: needs no account, no .dev.vars and no network
npm run build    # tsc -b && vite build: the client bundle (a change to the client or its types must still build)
```

All three must pass (CI runs them in that order, after `npm ci` and `npm audit --audit-level=high`). `npm run lint:fix` and `npm run format` fix most findings. A change in behaviour comes
with a test in `test/` that fails without it; a bug fix starts with the test that shows the bug. Do not keep throw-away tests or scratch files in the repository.

## Code style

- **TypeScript** in strict mode for both the Worker and the client.
- **ESLint** with the strict, type-checked typescript-eslint rule sets, React Hooks, jsx-a11y, import-x and unicorn (`eslint.config.js`). Do not add `eslint-disable`
  comments without a short reason next to them.
- **Prettier** decides formatting (`.prettierrc.json`: 140 columns, single quotes, semicolons, no trailing commas). Markdown is checked too.
- Comments explain why, not what. Keep diffs small: no drive-by refactors in a feature pull request.
- Update the docs in `docs/` when you change behaviour, an environment variable or an API route. A new route is added to [docs/api.md](docs/api.md) with its role, and
  every error answer carries a `code` from `src/worker/errors.ts`.
- Anything under `src/shared/crypto/` needs known-answer tests and a pass of `npm run check:bundle`: the Worker may seal mail for a person and may never open it.
- Dependencies: as few as possible, and only under MIT, ISC, BSD or Apache-2.0 licences. A new one is pinned, listed in [NOTICE](NOTICE) with its licence, and checked
  for install scripts and a provenance statement.
- No personal or deployment values in code, tests, fixtures or docs: use `example.com` and `example.org`. The maintainer's own values appear only in `wrangler.jsonc`,
  the licence and package metadata, and docs that call them the maintainer's example.
- `README.md` (English) is the source of truth. `README.vi.md` and `README.zh-CN.md` are translations of it: when you change the English README, update them too, or say in the pull request that they are out of date.

## Translations

The app speaks Vietnamese, English and Simplified Chinese. A wrong translation is an easy first pull request: the texts are plain JSON files in `src/shared/i18n/locales/`, and
`npm test` checks them (same keys, same placeholders, the glossary words, the length limits). How to fix a translation, change an English text and add a language is in
[docs/i18n.md](docs/i18n.md). New screens and messages are written with `tr('area.item')`, never with a hard-coded text: a test fails on one.

## Database changes

Change `src/worker/db/schema.ts`, run `npm run db:generate`, review the new SQL in `drizzle/`, and commit the whole `drizzle/` folder including `drizzle/meta/`. Do not
edit or regenerate a migration that has already shipped (`0000_init.sql` is hand-edited on purpose). A new migration must apply cleanly on a fresh database and on one
that already has the earlier migrations.

## Commit messages

Use [Conventional Commits](https://www.conventionalcommits.org/), as the history does:

```text
feat: add attachments to drafts
fix: bind the real D1 database so wrangler deploy works
refactor: resolve alias path cleanly with fileURLToPath
chore: stop tracking tsconfig.tsbuildinfo
docs: explain the Email Routing subdomain setup
```

Short imperative subject, lower case after the type, and a body that says why when the reason is not obvious.

## Never commit secrets

- Keep real values in `.dev.vars` (gitignored) or in Worker secrets. `.env*` files are gitignored too.
- Do not paste passwords, `JWT_SECRET`, API tokens or real mail content into issues, pull requests, commits or screenshots.
- If you committed a secret by accident, treat it as leaked: rotate it first, then remove it from the history.

## License

By contributing you agree that your contribution is released under the project's [MIT License](LICENSE).
