import type { Question } from '../copy.types';
import { esc } from '../html';
import { icon } from './icons';

/**
 * One question as a disclosure (`<details>`): the question is the h3 inside the summary (a 44 px row with a chevron that turns), the
 * answer is always in the HTML, so search engines and in-page search find it while it is closed. No script.
 */
export const accordionItem = (item: Question, startOpen = false): string =>
  `<details class="qa"${startOpen ? ' open' : ''}><summary><h3>${esc(item.question)}</h3>${icon('chevronDown', { className: 'chev' })}</summary><p>${esc(item.answer)}</p></details>`;

/**
 * The questions as one column of rows between hairlines, in reading order (the section puts its header in a column beside it on a
 * desktop). The first question starts open to show that the rows open. Use it for questions and answers only.
 */
export const accordion = (items: readonly Question[]): string =>
  `<div class="faq">${items.map((item, index) => accordionItem(item, index === 0)).join('')}</div>`;
