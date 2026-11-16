// When the recovery key was last tested in THIS browser (Settings > Security > Test key). The test runs in the browser and tells the server
// nothing (security.key_test_lead), so the server has no date to give: this device keeps one, per account, for the status line of the
// Security overview ("Last tested in this browser on ..."). Nothing secret is stored: an account id and a time.

const STORAGE_KEY = 'edging-mail-key-tested';

interface Stored {
  user: string;
  at: number;
}

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** Remembers that `userId` tested their current recovery key now (a successful test only). */
export function markKeyTested(userId: string, at: number = Date.now()): void {
  try {
    storage()?.setItem(STORAGE_KEY, JSON.stringify({ user: userId, at } satisfies Stored));
  } catch {
    // storage full or blocked: the overview simply shows no date
  }
}

/** Forgets the date (the key was replaced: a test of the old key says nothing about the new one). */
export function forgetKeyTested(): void {
  try {
    storage()?.removeItem(STORAGE_KEY);
  } catch {
    // nothing stored
  }
}

/** When `userId` last tested their recovery key in this browser, or null (never here, another account, unreadable). */
export function keyTestedAt(userId: string): number | null {
  try {
    const raw = storage()?.getItem(STORAGE_KEY);
    if (raw === null || raw === undefined) {
      return null;
    }
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null) {
      return null;
    }
    const stored = value as Partial<Stored>;
    return stored.user === userId && typeof stored.at === 'number' ? stored.at : null;
  } catch {
    return null;
  }
}
