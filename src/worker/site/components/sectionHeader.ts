import { esc } from '../html';

/** The background of a section: the page colour, or the surface colour with hairlines above and below (every other section). */
export type BandTone = 'plain' | 'alt';

/**
 * The header of a section: the small eyebrow, the h2 and an optional sub line. The h2 carries the `id` that labels the section and
 * that the top bar's links point at. Use it once per section, at its top; the h3 below it belong to the section's cards.
 */
export function sectionHeader(header: {
  readonly id: string;
  readonly eyebrow: string;
  readonly title: string;
  readonly sub?: string;
}): string {
  const sub = header.sub === undefined ? '' : `<p class="sub">${esc(header.sub)}</p>`;
  return `<div class="sh"><p class="eyebrow">${esc(header.eyebrow)}</p><h2 id="${header.id}">${esc(header.title)}</h2>${sub}</div>`;
}

/**
 * A section band of the page: a full-width background (`tone`) and the centred content column. `id` is the id of the h2 inside
 * (from sectionHeader), which names the section for screen readers. `body` is markup that is already escaped.
 */
export const band = (id: string, tone: BandTone, body: string, extraClass = ''): string =>
  `<section class="band${tone === 'alt' ? ' band-alt' : ''}${extraClass === '' ? '' : ` ${extraClass}`}" aria-labelledby="${id}">
      <div class="wrap">
        ${body}
      </div>
    </section>`;
