import type { QueryClient, QueryKey } from '@tanstack/react-query';
import { getUnlockedKey, onKeysWiped, subscribeUnlockedKey } from '../crypto/keyStore';

const bound = new WeakSet<QueryClient>();

/**
 * Keeps decrypted mail out of the query cache when it must not be there. `roots` are the query keys of everything that holds opened
 * mail (the lists and the readers).
 *  - Keys wiped (sign-out, a 401, an account switch): all of it is dropped.
 *  - A key appears or another one takes over (unlock, a new key): what was read before is read again, so rows that were locked, or sealed
 *    to the other key, are opened with the key that is there now.
 * Run once per client; calling it again is harmless.
 */
export function bindMailCache(queryClient: QueryClient, roots: readonly QueryKey[]): void {
  if (bound.has(queryClient)) {
    return;
  }
  bound.add(queryClient);
  let lastKeyId = getUnlockedKey()?.keyId ?? null;
  onKeysWiped(() => {
    lastKeyId = null;
    for (const queryKey of roots) {
      queryClient.removeQueries({ queryKey });
    }
  });
  subscribeUnlockedKey(() => {
    const keyId = getUnlockedKey()?.keyId ?? null;
    if (keyId === lastKeyId) {
      return;
    }
    lastKeyId = keyId;
    if (keyId !== null) {
      for (const queryKey of roots) {
        void queryClient.resetQueries({ queryKey });
      }
    }
  });
}
