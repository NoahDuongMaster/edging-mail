import { createElement, Fragment, useSyncExternalStore, type ReactNode } from 'react';
import { fmt, getLocale, subscribe, t, translatorFor, type Locale, type MessageKey, type Params, type TFunction } from './index';

/** The UI language. A component that reads it (or `useT()`) renders again when the language changes. */
export const useLocale = (): Locale => useSyncExternalStore(subscribe, getLocale, getLocale);

/** The translate function of the UI language. Every component with visible text calls this, so a language switch reaches it. */
export function useT(): TFunction {
  return translatorFor(useLocale());
}

/** `useT()` plus the locale and the formatters, for a component that also formats dates or numbers. */
export function useI18n(): { t: TFunction; locale: Locale; fmt: typeof fmt } {
  const locale = useLocale();
  return { t: translatorFor(locale), locale, fmt };
}

const PLACEHOLDER = /\{([A-Za-z0-9_]+)\}/g;

/**
 * Text with a few parts that need markup (a link, a bold name): the translator writes plain `{name}` slots, the component
 * fills them with elements. No HTML ever lives in a catalogue. Slots without a node show their own value from `params`.
 */
export function tRich(key: MessageKey, nodes: Readonly<Record<string, ReactNode>>, params?: Params): ReactNode {
  const template = t(key, params);
  const parts: ReactNode[] = [];
  let last = 0;
  for (const match of template.matchAll(PLACEHOLDER)) {
    const index = match.index;
    const slot = match[1];
    if (index > last) {
      parts.push(template.slice(last, index));
    }
    parts.push(createElement(Fragment, { key: `${slot}-${index}` }, nodes[slot] ?? match[0]));
    last = index + match[0].length;
  }
  if (last < template.length) {
    parts.push(template.slice(last));
  }
  return createElement(Fragment, null, ...parts);
}
