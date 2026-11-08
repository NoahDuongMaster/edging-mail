import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

// `npm test` runs the real Worker (src/worker/index.ts) inside workerd with a real D1 database that has every migration in
// drizzle/ applied, real R2 and the real MailHub Durable Object. Nothing here reads .dev.vars or .env: there is deliberately no
// wrangler config file (wrangler loads .dev.vars from the directory of the config it is given), every binding is declared below,
// and the secrets are fixed test values. No network is needed: tests that reach for DNS or a push service stub `fetch`.
// Two projects: everything runs in workerd, except test/static, which reads the source tree (there is no file system in workerd) and runs in Node.
export default defineConfig(async () => ({
  test: {
    projects: [
      {
        plugins: [
          cloudflareTest({
            main: './src/worker/index.ts',
            remoteBindings: false,
            miniflare: {
              // Same date and flags as wrangler.jsonc, plus the one flag vitest itself needs (it imports node:os inside the Worker).
              compatibilityDate: '2024-09-23',
              compatibilityFlags: ['nodejs_compat', 'enable_nodejs_os_module'],
              d1Databases: { DB: 'edging-mail-test' },
              r2Buckets: ['BUCKET'],
              durableObjects: { MAIL_HUB: { className: 'MailHub', useSQLite: true } },
              bindings: {
                APP_NAME: 'Edging Mail',
                // The tests run on a local deployment: a fake push service on loopback is accepted (test/push-endpoints.test.ts turns it off).
                ALLOW_LOCAL_PUSH: 'on',
                DEFAULT_FROM: 'hi@example.test',
                APP_PASSWORD: 'test-setup-key-0123456789',
                JWT_SECRET: 'test-jwt-secret-0123456789abcdef0123456789',
                // base64 of 32 fixed bytes; the second one stands in for a key that is being rotated out (DATA_KEY_PREVIOUS)
                DATA_KEY: 'P5ocflstQIah88Xnmw0kaKzhNXm98CRorOE1eQJGi98=',
                TEST_PREVIOUS_DATA_KEY: 'wbKjlIV2Z1hJOiscDR4vMEFSY3SFlqe4ydrh8gMUJTY=',
                // Read by test/setup.ts, never by the Worker.
                MIGRATIONS: await readD1Migrations('./drizzle')
              }
            }
          })
        ],
        test: {
          name: 'worker',
          include: ['test/**/*.test.ts'],
          exclude: ['test/static/**'],
          setupFiles: ['./test/setup.ts'],
          // Each file starts from an empty database (test/setup.ts); one worker keeps the suite deterministic and light on RAM.
          fileParallelism: false,
          testTimeout: 30_000
        }
      },
      {
        test: { name: 'static', environment: 'node', include: ['test/static/**/*.test.ts'] }
      }
    ]
  }
}));
