import React from 'react';
import { addressesToAsk, lookupKeys, previewOf } from '../../lib/sealedmail';
import type { KeyAnswer, Preview } from '../../lib/sealedmail';

// The data behind the quiet line under the recipient fields (EC-4). One lookup, 0.8 s after the recipients stopped changing, for the finished
// addresses nobody asked about yet in this compose; at most MAX_LOOKUPS of them per compose, so the preview never uses up the budget of the
// send (`/api/keys/lookup`: 60 calls in 15 minutes for everything). A lookup that fails says nothing and is not repeated: the send looks again
// and says what it needs.

const DEBOUNCE_MS = 800;
const MAX_LOOKUPS = 6;

interface Book {
  /** The compose this belongs to: every time the compose opens, and every other draft it opens with, starts with nothing asked. */
  opening: number;
  draft: unknown;
  answers: ReadonlyMap<string, KeyAnswer>;
  /** Asked for already (answered, still waiting or failed): not asked again in this compose. */
  asked: ReadonlySet<string>;
  lookups: number;
}

const belongs = (book: Book, opening: number, draft: unknown): boolean => book.opening === opening && book.draft === draft;

const emptyBook = (opening: number, draft: unknown): Book => ({ opening, draft, answers: new Map(), asked: new Set(), lookups: 0 });

/** `addresses`: the finished, lower-cased addresses of To, Cc and Bcc (`previewAddresses`). `draft` is whatever the compose was opened with. */
export function useComposePreview(input: {
  enabled: boolean;
  draft: unknown;
  addresses: readonly string[];
  fileSizes: readonly number[];
}): Preview {
  const { enabled, draft } = input;
  // Adjusting state while rendering, as the compose does for its form key: a compose that opens again is a new one.
  const [opened, setOpened] = React.useState({ enabled, count: 0 });
  const opening = enabled && !opened.enabled ? opened.count + 1 : opened.count;
  if (enabled !== opened.enabled) {
    setOpened({ enabled, count: opening });
  }
  const [stored, setStored] = React.useState<Book>(() => emptyBook(opening, draft));
  const current = stored.opening === opening && stored.draft === draft;
  const book = current ? stored : emptyBook(opening, draft);
  if (!current) {
    setStored(book);
  }
  const wanted = input.addresses.join('\n');
  const { answers, asked, lookups } = book;

  React.useEffect(() => {
    if (!enabled) {
      return;
    }
    const ask = addressesToAsk(wanted === '' ? [] : wanted.split('\n'), asked, lookups, MAX_LOOKUPS);
    if (ask.length === 0) {
      return;
    }
    const timer = window.setTimeout(() => {
      // Counted when asked, so a slow answer does not invite a second request for the same addresses.
      setStored((now) =>
        belongs(now, opening, draft) ? { ...now, lookups: now.lookups + 1, asked: new Set([...now.asked, ...ask]) } : now
      );
      lookupKeys(ask)
        .then((found) => {
          setStored((now) => (belongs(now, opening, draft) ? { ...now, answers: new Map([...now.answers, ...found]) } : now));
        })
        .catch(() => {
          // Quiet: no line. The send asks again.
        });
    }, DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [enabled, opening, draft, wanted, asked, lookups]);

  return enabled ? previewOf({ addresses: input.addresses, answers, fileSizes: input.fileSizes }) : { state: 'unknown' };
}
