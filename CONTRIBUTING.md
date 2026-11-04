# Contributing to Edging Mail

Thanks for helping. This is a small single-user project, so the process is light: open an issue or a pull request, keep `npm run check` green, and keep the change
focused.

## Before you start

- **Bugs and small fixes:** open a pull request directly.
- **New features or anything that changes behaviour:** open an issue first and describe the problem you want solved. Edging Mail is single-user by design, so features
  that need accounts, tenants or shared mailboxes are out of scope.
- **Security problems:** do not open a public issue. Use **Security → Report a vulnerability** on the repository page (see [docs/security.md](docs/security.md)).

## Set up

You need Node.js 24 or newer and npm. You do not need a Cloudflare account: `wrangler dev` emulates D1, R2 and Durable Objects locally.

```bash
git clone https://github.com/<your-fork>/edging-mail.git
cd edging-mail
npm install
cp .dev.vars.example .dev.vars    # set APP_PASSWORD (12+ characters) and JWT_SECRET (32+ characters)
npm run db:migrate:local
npm run build
npm run worker:dev                # http://localhost:8787
```

For hot reload on the client, run `npm run dev` next to `npm run worker:dev`. How to feed the local inbox a real MIME message, test the snooze cron and work with
migrations is in [docs/development.md](docs/development.md).

## Before you open a pull request

```bash
npm run check    # tsc -b && eslint . && prettier --check .
```

It must pass. `npm run lint:fix` and `npm run format` fix most findings. There is no automated test suite yet, so describe in the pull request how you tried the
change (for example "sent a test mail through `/cdn-cgi/handler/email`, replied, snoozed it"). A test suite would be a welcome contribution in itself.

## Code style

- **TypeScript** in strict mode for both the Worker and the client.
- **ESLint** with the strict, type-checked typescript-eslint rule sets, React Hooks, jsx-a11y, import-x and unicorn (`eslint.config.js`). Do not add `eslint-disable`
  comments without a short reason next to them.
- **Prettier** decides formatting (`.prettierrc.json`: 140 columns, single quotes, semicolons, no trailing commas). Markdown is checked too.
- Comments explain why, not what. Keep diffs small: no drive-by refactors in a feature pull request.
- Update the docs in `docs/` when you change behaviour, an environment variable or an API route.

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
- Do not paste passwords, `JWT_SECRET`, `VAPID_PRIVATE_KEY`, API tokens or real mail content into issues, pull requests, commits or screenshots.
- If you committed a secret by accident, treat it as leaked: rotate it first, then remove it from the history.

## License

By contributing you agree that your contribution is released under the project's [MIT License](LICENSE).
