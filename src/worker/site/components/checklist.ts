import type { LandingUi } from '../copy.types';
import { esc } from '../html';
import { icon } from './icons';

/** What a statement of the security lists is: something the product guarantees, or a limit the reader has to know. */
export type CheckKind = 'protected' | 'limit';

const MARK = { protected: 'check', limit: 'limitMark' } as const;

/** The mark in front of a statement: a check for a guarantee, the warning mark (an exclamation) for a limit, named for screen readers. */
const mark = (kind: CheckKind, legend: LandingUi['legend']): string =>
  icon(MARK[kind], { label: legend[kind], className: `mark mark-${kind}` });

/** The longest lead clause that still reads as one line of the list (characters; a Chinese character is about two Latin ones). */
const LEAD_MAX = { latin: 96, han: 34 } as const;

/**
 * Splits an approved statement into the clause read first (set in the title weight) and the rest (in the second text colour),
 * without changing a character: a short label before a colon ("Not encrypted:"), or else the first sentence when another one
 * follows it (a full stop then a capital, or the Chinese full stop). A statement of one sentence is all lead. A lead longer than
 * about a line (`LEAD_MAX`, fewer characters for Chinese) is no scan cue, so then the whole statement stays plain (`lead` empty).
 * `lead` + `gap` + `rest` is the statement again.
 */
export function leadClause(text: string): { readonly lead: string; readonly gap: string; readonly rest: string } {
  const label = /^([^:：]{1,40}[:：])(\s*)(\S[\s\S]*)$/u.exec(text);
  const sentence = label ?? /^(.+?(?:[.?!](?=\s+\p{Lu})|[。？！](?=\S)))(\s*)(\S[\s\S]*)$/u.exec(text);
  const [lead, gap, rest] = sentence === null ? [text, '', ''] : sentence.slice(1);
  const max = /\p{Script=Han}/u.test(text) ? LEAD_MAX.han : LEAD_MAX.latin;
  // The copy is NFC text in the Basic Multilingual Plane, so its UTF-16 length is its length in characters.
  return lead.length <= max ? { lead, gap, rest } : { lead: '', gap: '', rest: text };
}

/**
 * A statement as markup: the lead clause in `<b>` and the rest in a `<span>` (in the lists the CSS sets the lead as a small
 * sub-heading on its own line; in a callout it stays inline), or the whole statement as plain text when it has no lead or is all
 * lead (a one-sentence statement reads as body, not as a heading with nothing under it). The text is the approved statement,
 * character for character.
 */
export function statement(text: string): string {
  const { lead, gap, rest } = leadClause(text);
  return lead === '' || rest === '' ? esc(text) : `<b>${esc(lead)}</b>${gap}<span>${esc(rest)}</span>`;
}

/**
 * A titled group of security statements: the h3 (plain, nothing else in it) and the `checks` list of rows, every row marked by
 * its kind. A guarantee is a plain row with a check; a limit is a row on its own quiet fill with the warning mark, so the two kinds
 * part at a glance while the words keep one text colour. Use it only for statements that are true or false about the product; a
 * limit never gets a check.
 */
export function checkGroup(
  group: { readonly title: string; readonly items: readonly string[] },
  kinds: readonly CheckKind[],
  legend: LandingUi['legend']
): string {
  const items = group.items.map((item, index) => {
    const kind = kinds[index] ?? 'limit';
    return `<li class="is-${kind}">${mark(kind, legend)}<span class="check-text">${statement(item)}</span></li>`;
  });
  return `<article class="group"><h3>${esc(group.title)}</h3><ul class="checks">${items.join('')}</ul></article>`;
}

/** The key to the two marks, shown once, beside the caption of the diagram above the groups. */
export const checkLegend = (legend: LandingUi['legend']): string =>
  `<span class="legend" aria-hidden="true"><span>${icon(MARK.protected, { className: 'mark mark-protected' })}${esc(legend.protected)}</span><span>${icon(MARK.limit, { className: 'mark mark-limit' })}${esc(legend.limit)}</span></span>`;
