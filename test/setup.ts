import { env } from 'cloudflare:workers';
import { applyD1Migrations } from 'cloudflare:test';
import { afterEach, beforeAll, beforeEach, vi } from 'vitest';
import type * as Throttle from '../src/worker/auth/throttle';
import type { Db } from '../src/worker/db';
import { floor } from './floor';

// The pause after a refused sign-in is skipped unless the test sets `floor.real` (test/floor.ts). The failure is still recorded, so the
// counters, locks and audit rows behave exactly as in production; only the sleep is gone.
vi.mock('../src/worker/auth/throttle', async (importOriginal) => {
  const real = await importOriginal<typeof Throttle>();
  // Read at call time through an import: vi.mock is hoisted above this file's own imports.
  const { floor: switchboard } = await import('./floor');
  return {
    ...real,
    failureDelay: async (db: Db, startedAt: number): Promise<void> => {
      await (switchboard.real ? real.failureDelay(db, startedAt) : real.recordGlobalFailure(db));
    },
    holdFloor: (startedAt: number): Promise<void> => (switchboard.real ? real.holdFloor(startedAt) : Promise.resolve())
  };
});

afterEach(() => {
  floor.real = false;
});

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
  'revoked_sessions',
  'user_avatars',
  'sender_pictures',
  'mail_filters',
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
