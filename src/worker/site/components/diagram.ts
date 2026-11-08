import type { DiagramNode } from '../copy.types';
import { esc } from '../html';
import { icon, type IconName } from './icons';

/** One box of the diagram: its glyph, its words and its tag, and whether it is the place that holds the key (accent tint). */
export interface DiagramPart extends DiagramNode {
  readonly glyph: IconName;
  readonly tagIcon: IconName;
  readonly key?: boolean;
}

const node = (part: DiagramPart): string =>
  `<div class="node${part.key === true ? ' node-key' : ''}"><span class="node-icon">${icon(part.glyph)}</span><span class="node-words"><span class="node-title">${esc(part.title)}</span><span class="node-text">${esc(part.text)}</span></span><span class="node-tag">${icon(part.tagIcon)}${esc(part.tag)}</span></div>`;

// A wire is drawn in the accent: it is the protected path. Its badge says what crosses it: mail both ways, still encrypted
// (arrows), or mail going into storage encrypted (a lock).
const wire = (kind: 'both' | 'lock'): string =>
  `<span class="wire wire-${kind}" aria-hidden="true"><span class="wire-badge">${icon(kind === 'lock' ? 'lock' : 'arrowsLeftRight')}</span></span>`;

/**
 * The security architecture, the centrepiece of its section: the browser that holds the key, then a dashed boundary for the
 * company's Cloudflare account around the Worker (can seal, cannot open) and the storage (D1 and R2, ciphertext), joined by accent
 * wires. The boxes are real text, so the figure is its own text alternative (read in order with the boundary label and the
 * caption); the wires are decorative. One row from a tablet up, stacked on a phone. `aside` sits beside the caption (the key to the
 * marks of the lists under the figure).
 */
export function archDiagram(figure: {
  readonly caption: string;
  readonly zone: string;
  readonly browser: DiagramPart;
  readonly worker: DiagramPart;
  readonly storage: DiagramPart;
  readonly aside?: string;
}): string {
  const zone = `<div class="arch-zone"><span class="arch-zone-label">${icon('cloud')}${esc(figure.zone)}</span>${node(figure.worker)}${wire('lock')}${node(figure.storage)}</div>`;
  return `<figure class="arch"><div class="arch-flow">${node(figure.browser)}${wire('both')}${zone}</div><figcaption><span>${esc(figure.caption)}</span>${figure.aside ?? ''}</figcaption></figure>`;
}
