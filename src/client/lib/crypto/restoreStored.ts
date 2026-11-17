import { fetchMyKeys, type MyKeys } from './unlock';
import { restoreKey } from './keyStore';

/** How often the app asks the server for the person's keys at start before it gives up and shows the unlock screen. */
export const RESTORE_ATTEMPTS = 3;
/** The wait after the first failed attempt; the second waits twice as long. */
export const RESTORE_RETRY_MS = 1500;

interface RestoreDeps {
  fetchKeys?: () => Promise<MyKeys>;
  wait?: (ms: number) => Promise<void>;
  /** True once the caller no longer wants the answer (the screen went away): stops the retries. */
  cancelled?: () => boolean;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * At app start with a signed-in person: uses the key stored on this device when it is recent and still the key the server holds
 * (`restoreKey`). The check needs the server's public key, and a phone that has just woken up often has no connection for the first second or two:
 * an unreachable server is asked again a few times before the person is asked for the password they already gave, with a key still
 * sitting in IndexedDB. Whatever the outcome, the caller reads the answer from the key store (`getUnlockedKey`).
 */
export async function restoreStoredKey(userId: string, deps: RestoreDeps = {}): Promise<void> {
  const { fetchKeys = fetchMyKeys, wait = sleep, cancelled = () => false } = deps;
  for (let attempt = 1; attempt <= RESTORE_ATTEMPTS; attempt += 1) {
    try {
      const { keys } = await fetchKeys();
      if (keys !== null) {
        await restoreKey(userId, keys);
      }
      return;
    } catch {
      // The server could not be reached (or answered an error): ask again, then fall back to the unlock screen.
    }
    if (attempt < RESTORE_ATTEMPTS) {
      await wait(RESTORE_RETRY_MS * attempt);
      if (cancelled()) {
        return;
      }
    }
  }
}
