import type { Card } from '../copy.types';
import { esc } from '../html';

/**
 * The shape of a bento tile: `wide` spans two columns, `full` spans the whole row and puts its text beside the picture on a desktop,
 * `phone` is one cell whose picture (a phone) runs off the bottom edge, and `small` is one cell. Except `full`, the picture sits above
 * the text.
 */
export type TileShape = 'wide' | 'full' | 'phone' | 'small';

/** The grid area letter of each tile, in the order of the features in the copy (the CSS places the areas). */
const AREAS = ['a', 'b', 'c', 'd', 'e', 'f'] as const;

/**
 * One tile of the features grid: a product fragment (decorative, `aria-hidden`) and the feature's h3 and text, which stay real text.
 * `index` is the feature's place in the copy and picks the tile's grid area.
 */
export function bentoTile(item: Card, index: number, shape: TileShape, fragment: string): string {
  const area = AREAS[index] ?? 'a';
  return `<article class="tile tile-${shape} tile-${area}"><div class="tile-art" aria-hidden="true">${fragment}</div><div class="tile-body"><h3>${esc(item.title)}</h3><p>${esc(item.text)}</p></div></article>`;
}

/**
 * The features grid: tiles of mixed sizes (one wide and one phone, three small, one full row on a desktop; two columns on a tablet;
 * one column on a phone). Use it for the one section that shows the product's parts; everywhere else a section has its own composition.
 */
export const bento = (tiles: readonly string[]): string => `<div class="bento">${tiles.join('')}</div>`;
