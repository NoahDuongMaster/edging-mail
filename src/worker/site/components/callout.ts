import { esc } from '../html';
import { statement } from './checklist';
import { icon } from './icons';

/** The tone of a callout: a caveat the reader must weigh (warning), or a plain note (info). */
export type CalloutTone = 'warning' | 'info';

/**
 * A notice inside the flow of a section: the tone's mark on its soft chip (a warning takes the "!" of the limit rows) and one
 * paragraph (a warning's first sentence in the title weight, the words unchanged), on a neutral surface with a hairline all round (no
 * coloured rail, no full tinted box). Use it for the one caveat a reader must not miss, at the end of its section and as wide as the
 * section; never as decoration or for marketing copy.
 */
export const callout = (tone: CalloutTone, text: string): string =>
  `<div class="callout callout-${tone}" role="note">${icon(tone === 'warning' ? 'limitMark' : 'info', { className: 'callout-mark' })}<p>${tone === 'warning' ? statement(text) : esc(text)}</p></div>`;
