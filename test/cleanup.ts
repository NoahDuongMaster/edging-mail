import { afterAll, vi } from 'vitest';

// `isolate: false` (vitest.config.ts) runs several files one after another in the same runner. Whatever a file leaves behind (fake timers,
// stubbed globals, spies) must not reach the next one, so the runner is put back after every file.
afterAll(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
