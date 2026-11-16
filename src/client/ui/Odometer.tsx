import React from 'react';
import { DURATION, EASING } from '../../shared/design/tokens';
import { cx } from './cx';
import { motionReduced } from './motion';

// v3 signature H2 (DESIGN-v3 section 3): a count rolls to its new value, like an odometer. Each changed digit rolls vertically (up when the
// number grows, down when it falls) in --dur-roll with --ease-emph-enter; a number that changes length (9 -> 10) or shape (a separator
// moved) cross-fades. Only ASCII digits roll: what a locale formatter adds (separators, other digits, words) stays still. Screen readers get
// one text node with the value; the drawn digits are aria-hidden. It is cheap in a long list: an unchanged count does nothing, a changed one
// animates `transform` and `opacity` of a few spans (WAAPI), measures nothing, and leaves no extra element behind. Under reduced motion
// (and on the server) it is plain text that changes at once.

export interface OdometerProps {
  value: number;
  /** Formats the number (the app's locale formatter); default: String(value). */
  format?: (value: number) => string;
  className?: string;
}

const isDigit = (char: string): boolean => char >= '0' && char <= '9';

/** Where the digits and the other characters are: two texts of the same shape roll digit by digit, others cross-fade. */
/** The characters of a formatted number, one per code point. */
function charsOf(text: string): string[] {
  const chars: string[] = [];
  for (const char of text) {
    chars.push(char);
  }
  return chars;
}

const shapeOf = (text: string): string =>
  charsOf(text)
    .map((char) => (isDigit(char) ? '0' : char))
    .join('');

/** One digit rolls from `before` to its new glyph: the new one comes in from below (up) or above (down), the old one leaves the other way. */
function rollDigit(cell: HTMLElement, before: string, up: boolean, delay: number): void {
  const glyph = cell.firstElementChild;
  if (!(glyph instanceof HTMLElement)) {
    return;
  }
  const old = document.createElement('span');
  old.className = 'ui-odo-old';
  old.textContent = before;
  cell.insertBefore(old, null);
  const timing: KeyframeAnimationOptions = { duration: DURATION.roll, delay, easing: EASING.emphEnter, fill: 'backwards' };
  const from = up ? '100%' : '-100%';
  const to = up ? '-100%' : '100%';
  glyph.animate([{ transform: `translateY(${from})` }, { transform: 'none' }], timing);
  // The old glyph leaves on the standard curve: the front-loaded enter curve made it vanish in a frame while the new one took four.
  const leaving = old.animate(
    [
      { transform: 'none', opacity: 1 },
      { transform: `translateY(${to})`, opacity: 0.4 }
    ],
    { ...timing, easing: EASING.standard, fill: 'forwards' }
  );
  const remove = () => {
    old.remove();
  };
  void leaving.finished.then(remove, remove);
}

/** The whole number changed its shape: the old text fades out moving away while the new one comes in. */
function crossFade(face: HTMLElement, before: string, up: boolean): void {
  const ghost = document.createElement('span');
  ghost.className = 'ui-odo-ghost';
  ghost.textContent = before;
  face.insertBefore(ghost, null);
  const shift = up ? 40 : -40;
  const timing: KeyframeAnimationOptions = { duration: DURATION.roll, easing: EASING.emphEnter };
  for (const cell of face.children) {
    if (cell !== ghost && cell instanceof HTMLElement) {
      cell.animate(
        [
          { transform: `translateY(${shift}%)`, opacity: 0 },
          { transform: 'none', opacity: 1 }
        ],
        { ...timing, fill: 'backwards' }
      );
    }
  }
  const leaving = ghost.animate(
    [
      { transform: 'none', opacity: 1 },
      { transform: `translateY(${-shift}%)`, opacity: 0 }
    ],
    { ...timing, fill: 'forwards' }
  );
  const remove = () => {
    ghost.remove();
  };
  void leaving.finished.then(remove, remove);
}

/** Rolls the drawn face (already showing `after`) from `before`. */
function roll(face: HTMLElement, before: string, after: string, up: boolean): void {
  // A roll still running is cut: its leaving glyphs go, the face shows the newest value.
  for (const animation of face.getAnimations({ subtree: true })) {
    animation.cancel();
  }
  for (const left of face.querySelectorAll('.ui-odo-old, .ui-odo-ghost')) {
    left.remove();
  }
  if (shapeOf(before) !== shapeOf(after)) {
    crossFade(face, before, up);
    return;
  }
  const cells = [...face.children].filter((cell) => cell.matches('.ui-odo-d, .ui-odo-s'));
  const was = charsOf(before);
  const now = charsOf(after);
  let changed = 0;
  // From the units digit leftwards, each a little later: the roll reads like a carry.
  for (let index = now.length - 1; index >= 0; index--) {
    const cell = cells[index];
    const char = now[index] ?? '';
    if (cell instanceof HTMLElement && was[index] !== char && isDigit(char)) {
      rollDigit(cell, was[index] ?? '', up, changed * 30);
      changed += 1;
    }
  }
}

/** A number whose changed digits roll (tabular figures); one accessible text node with the formatted value. */
export function Odometer({ value, format, className }: OdometerProps): React.JSX.Element {
  const text = format === undefined ? String(value) : format(value);
  const faceRef = React.useRef<HTMLSpanElement | null>(null);
  const shown = React.useRef<{ text: string; value: number } | null>(null);

  // After the commit the face already shows the new text; the roll starts from the one shown before (nothing on the first render).
  React.useLayoutEffect(() => {
    const before = shown.current;
    shown.current = { text, value };
    const face = faceRef.current;
    if (face === null || before === null || before.text === text || motionReduced()) {
      return;
    }
    roll(face, before.text, text, value >= before.value);
  }, [text, value]);

  const chars = charsOf(text);
  return (
    <span className={cx('ui-odo', className)}>
      <span className="ui-visually-hidden">{text}</span>
      <span ref={faceRef} className="ui-odo-face" aria-hidden="true">
        {chars.map((char, index) =>
          // Keyed from the right: the units digit stays the same element when the number grows a digit on the left (a cell IS a
          // position, so its index is its identity).
          isDigit(char) ? (
            // eslint-disable-next-line react/no-array-index-key -- see above
            <span key={chars.length - index} className="ui-odo-d">
              <span className="ui-odo-g">{char}</span>
            </span>
          ) : (
            // eslint-disable-next-line react/no-array-index-key -- see above
            <span key={chars.length - index} className="ui-odo-s">
              {char}
            </span>
          )
        )}
      </span>
    </span>
  );
}
