import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

// `npm test` runs the real Worker (src/worker/index.ts) inside workerd with a real D1 database that has every migration in
// drizzle/ applied, real R2 and the real MailHub Durable Object. Nothing here reads .dev.vars or .env: there is deliberately no
// wrangler config file (wrangler loads .dev.vars from the directory of the config it is given), every binding is declared below,
// and the secrets are fixed test values. No network is needed: tests that reach for DNS or a push service stub `fetch`.
//
// Three projects, split by what a file needs:
// - worker: the Worker and its bindings, in workerd.
// - node: files that only read source text or render client code to a string (no database to reset between tests).
// - node-isolated: files that replace a module for the whole file (`vi.mock`), which needs a fresh module graph.
//
// Speed: `isolate: false` keeps one runner per pool slot for the whole run. With the default, every file started its own Miniflare (about
// two seconds each) and its own Node thread. Each slot has its own Miniflare, so its own in-memory D1, R2 and
// Durable Objects: files running side by side cannot see each other's rows, and each file still starts from an empty database
// (test/setup.ts), and `test/cleanup.ts` resets what a file may leave in the runner.
//
// test/i18n/wiring.test.ts renders the Worker's pages, so it stays a worker test.
const NODE_FILES = ['test/static/**/*.test.ts', 'test/client/**/*.test.ts', 'test/i18n/!(wiring).test.ts'];
const ISOLATED_FILES = ['test/client/language-init.test.ts'];

export default defineConfig(async () => ({
  test: {
    maxWorkers: 3,
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
          // Every test file is a worker test unless NODE_FILES takes it, so a new file can never fall out of the run.
          include: ['test/**/*.test.ts'],
          exclude: NODE_FILES,
          setupFiles: ['./test/cleanup.ts', './test/setup.ts'],
          isolate: false,
          testTimeout: 30_000
        }
      },
      {
        test: {
          name: 'node',
          environment: 'node',
          pool: 'threads',
          isolate: false,
          setupFiles: ['./test/cleanup.ts'],
          include: NODE_FILES,
          exclude: ISOLATED_FILES
        }
      },
      {
        test: { name: 'node-isolated', environment: 'node', pool: 'threads', include: ISOLATED_FILES }
      }
    ]
  }
}));
