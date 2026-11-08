import type { UnlockedKey } from '../crypto/keyStore';

// Reading encrypted mail in the browser (EM1, crypto-design.md section 5). The Worker stores every message as blobs; these modules open them
// with the person's unlocked key. Decrypted text exists in memory only: it is handed to the caller and never written, logged or kept in a
// module-level variable (the one exception is the per-row content key, see cek.ts, which is wiped with the keys).

/** The part of the unlocked key that opening mail needs. `getUnlockedKey()` is one; tests build one from a generated pair. */
export type OpenKey = Pick<UnlockedKey, 'pair' | 'keyId'>;

/** Fetches one URL of this app. Injected so tests need no network; the default is `fetch` with the session cookie. */
export type Fetcher = (url: string) => Promise<Response>;

export const sameOriginFetch: Fetcher = (url) => fetch(url, { credentials: 'same-origin' });

/** Something that could not be opened or downloaded. The message is fixed text: it never quotes what was parsed. */
export class MailOpenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MailOpenError';
  }
}
