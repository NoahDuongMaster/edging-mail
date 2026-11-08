import type { Card } from '../copy.types';
import { esc } from '../html';

/**
 * A numbered list of steps joined by a line, each with its number in a circle, an h3 and its text. Use it for an order the reader
 * follows (setup), never for a set of points that have no order. The numbers are decorative: the step titles already say them.
 */
export const stepper = (steps: readonly Card[]): string =>
  `<ol class="steps">${steps
    .map(
      (step, index) =>
        `<li class="step"><span class="step-num" aria-hidden="true">${index + 1}</span><div class="step-body"><h3>${esc(step.title)}</h3><p>${esc(step.text)}</p></div></li>`
    )
    .join('')}</ol>`;
