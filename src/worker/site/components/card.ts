import type { Card } from '../copy.types';
import { esc } from '../html';

/**
 * A benefit card: a small product visual on top (decorative, hidden from screen readers), then the point's h3 and its text. Use it
 * for a short row of equal points where each one has its own picture; a point without a picture is a plain list item instead.
 */
export const card = (item: Card, visual: string): string =>
  `<article class="card"><div class="card-visual" aria-hidden="true">${visual}</div><div class="card-body"><h3>${esc(item.title)}</h3><p>${esc(item.text)}</p></div></article>`;

/** A row of benefit cards (one column on a phone, three from a narrow desktop up). */
export const cardRow = (cards: readonly string[]): string => `<div class="cards">${cards.join('')}</div>`;
