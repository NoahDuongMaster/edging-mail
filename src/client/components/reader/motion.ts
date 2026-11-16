import { DURATION, EASING } from '../../../shared/design/tokens';
import { motionReduced } from '../../ui/motion';

// M9 (DESIGN.md section 3, research/02): the reader's own motion. Data and focus never wait for it; under reduced motion only a short fade
// is left.

/** Presses closer together than this are rapid triage: the next message is just there, no motion. */
const RAPID_MS = 300;
let lastMove = 0;

/**
 * Desktop next / previous (M9, J2-01): the new message, already rendered where the last one stood (the reader keeps the last one on screen
 * while the next loads, so there is never a blank or grey page in between), crossfades in along the list's axis: from 8 px below for an
 * older one (`dir` 1) or above for a newer one (-1), from 40 % opacity (never from 0: the page is never blank), in 150 ms (enter easing).
 * Under reduced motion: the same fade, no move. Nothing when presses come in a quick run.
 */
export function nextMessageIn(el: HTMLElement, dir: 1 | -1): void {
  const now = performance.now();
  const rapid = now - lastMove < RAPID_MS;
  lastMove = now;
  if (rapid) {
    return;
  }
  if (motionReduced()) {
    el.animate([{ opacity: 0.4 }, { opacity: 1 }], { duration: DURATION.quick, easing: 'linear' });
    return;
  }
  el.animate(
    [
      { opacity: 0.4, transform: `translateY(${8 * dir}px)` },
      { opacity: 1, transform: 'none' }
    ],
    { duration: DURATION.quick, easing: EASING.enter }
  );
}

/** The place of the open message among the others, read from the counter ("3 of 30", "第 3 封"): its first number, or null. */
export function positionIndex(position: string): number | null {
  const match = /\d+/.exec(position);
  return match === null ? null : Number(match[0]);
}
