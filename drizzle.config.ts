import { defineConfig } from 'drizzle-kit';

// `npm run db:generate` diffs schema.ts against drizzle/meta and writes a new
// SQL migration into drizzle/. Wrangler applies them (see wrangler.jsonc
// `migrations_dir`), drizzle-kit itself never touches the database.
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/worker/db/schema.ts',
  out: './drizzle'
});
