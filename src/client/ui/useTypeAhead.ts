import React from 'react';

/** Letters typed within this many ms of each other count as one word. */
const TYPE_AHEAD_MS = 600;

export interface TypeAhead {
  /** Adds a typed letter to the word and returns the word so far. */
  add: (letter: string) => string;
  /** True while a word is being typed (a Space then belongs to the word, not to "open"). */
  typing: () => boolean;
}

/**
 * Collects the letters a person types into a list (a select, a menu) into one word, which `typeAheadIndex` (listNav.ts) turns into
 * a row. The word is forgotten after a short pause.
 */
export function useTypeAhead(): TypeAhead {
  const word = React.useRef('');
  const timer = React.useRef<number | undefined>(undefined);

  React.useEffect(
    () => () => {
      window.clearTimeout(timer.current);
    },
    []
  );

  return React.useMemo(
    () => ({
      add: (letter: string) => {
        word.current += letter;
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => {
          word.current = '';
        }, TYPE_AHEAD_MS);
        return word.current;
      },
      typing: () => word.current !== ''
    }),
    []
  );
}
