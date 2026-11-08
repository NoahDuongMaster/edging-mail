/// <reference types="@cloudflare/vitest-plugin/types" />
import type { D1Migration } from '@cloudflare/vitest-plugin';
import type { Env as WorkerEnv } from '../src/worker/types';

// Declares the 'cloudflare:test' module (here, not in tsconfig `types`, so the lint run of the root config files does not load it) and
// types `env` from 'cloudflare:workers' with the Worker's own bindings (vitest.config.ts declares them).
declare global {
  namespace Cloudflare {
    interface Env extends WorkerEnv {
      /** Every drizzle/*.sql file, applied by test/setup.ts. */
      MIGRATIONS: D1Migration[];
      /** A second fixed DATA_KEY, for the rotation tests. */
      TEST_PREVIOUS_DATA_KEY: string;
    }
  }
}
