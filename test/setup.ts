import { env } from 'cloudflare:workers';
import { applyD1Migrations } from 'cloudflare:test';
import { beforeAll, beforeEach } from 'vitest';

// Every test file starts with all migrations applied (idempotent: applied ones are skipped).
beforeAll(async () => {
  await applyD1Migrations(env.DB, env.MIGRATIONS);
});

// Children before parents (foreign keys). `d1_migrations` and the schema stay.
const TABLES = [
  'two_factor_challenges',
  'recovery_codes',
  'recovery_tickets',
  'user_security_events',
  'user_keys',
  'audit_log',
  'user_sign_ins',
  'login_attempts',
  'push_subscriptions',
  'push_keys',
  'attachments',
  'messages',
  'addresses',
  'domains',
  'settings',
  'users'
];

// Every test starts from an empty database and an empty bucket, so tests never depend on each other or on their order.
beforeEach(async () => {
  await env.DB.batch(TABLES.map((table) => env.DB.prepare(`DELETE FROM ${table}`)));
  let cursor: string | undefined;
  do {
    const listing = await env.BUCKET.list({ cursor });
    if (listing.objects.length > 0) {
      await env.BUCKET.delete(listing.objects.map((object) => object.key));
    }
    cursor = listing.truncated ? listing.cursor : undefined;
  } while (cursor !== undefined);
});
