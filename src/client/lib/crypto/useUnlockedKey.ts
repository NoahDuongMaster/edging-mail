import React from 'react';
import { getUnlockedKey, subscribeUnlockedKey } from './keyStore';
import type { UnlockedKey } from './keyStore';

/** The key in use, re-rendering when it appears or goes (sign-in, unlock, sign-out, a wipe). Null while locked. */
export function useUnlockedKey(): UnlockedKey | null {
  return React.useSyncExternalStore(subscribeUnlockedKey, getUnlockedKey, getUnlockedKey);
}
