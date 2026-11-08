import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

describe('harness', () => {
  it('runs against real D1 with every migration applied', async () => {
    const tables = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all<{ name: string }>();
    const names = tables.results.map((row) => row.name);
    for (const table of ['addresses', 'attachments', 'audit_log', 'domains', 'login_attempts', 'messages', 'push_subscriptions', 'users']) {
      expect(names).toContain(table);
    }
    const applied = await env.DB.prepare('SELECT count(*) AS n FROM d1_migrations').first<{ n: number }>();
    expect(applied?.n).toBe(env.MIGRATIONS.length);
  });

  it('enforces foreign keys', async () => {
    const row = await env.DB.prepare('PRAGMA foreign_keys').first<{ foreign_keys: number }>();
    expect(row?.foreign_keys).toBe(1);
  });

  it('uses the fixed test secrets, never a .dev.vars file', () => {
    expect(env.JWT_SECRET).toBe('test-jwt-secret-0123456789abcdef0123456789');
    expect(env.APP_PASSWORD).toBe('test-setup-key-0123456789');
    // Besides the declared bindings, the test pool adds its own __VITEST_* plumbing.
    expect(
      Object.keys(env)
        .filter((key) => !key.startsWith('__VITEST_'))
        .toSorted()
    ).toEqual([
      'ALLOW_LOCAL_PUSH',
      'APP_NAME',
      'APP_PASSWORD',
      'BUCKET',
      'DATA_KEY',
      'DB',
      'DEFAULT_FROM',
      'JWT_SECRET',
      'MAIL_HUB',
      'MIGRATIONS',
      'TEST_PREVIOUS_DATA_KEY'
    ]);
  });
});
