// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DARK, LIGHT } from '../../src/shared/design/tokens';
import { ROOT } from './helpers/scan';

// The round-1 fixes of the mailbox shell that only the stylesheets and index.html can show (the jury's ids in each test name), kept as
// source facts so a later restyle does not bring them back.

const read = (...parts: string[]): string => readFileSync(path.join(ROOT, ...parts), 'utf8');
const css = (name: string): string => read('src', 'client', 'components', name).replaceAll(/\/\*[\s\S]*?\*\//g, '');
/** The declarations of the first rule whose selector is exactly `selector`. */
function rule(sheet: string, selector: string): string {
  const at = sheet.indexOf(`${selector} {`);
  expect(at, selector).toBeGreaterThanOrEqual(0);
  return sheet.slice(at, sheet.indexOf('}', at));
}

/** WCAG relative luminance and contrast of two #RRGGBB colours. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5]
    .map((start) => Number.parseInt(hex.slice(start, start + 2), 16) / 255)
    .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const ratio = (a: string, b: string): number => {
  const [light, dark] = [luminance(a), luminance(b)].toSorted((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
};

describe('mailbox shell stylesheets (round-1 fixes)', () => {
  const mailbox = css('mailbox.css');
  const list = css('messagelist.css');

  it('J1-03: the C on Compose is white on the pressed accent, 4.5:1 or more in both themes', () => {
    expect(rule(mailbox, '.mb-compose .ui-kbd')).toMatch(/background: var\(--accent-hover\);/);
    expect(rule(mailbox, '.mb-compose .ui-kbd')).toMatch(/color: var\(--on-accent\);/);
    for (const palette of [LIGHT, DARK]) {
      expect(ratio(palette.onAccent, palette.accentHover)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('J1-04: the search placeholder is text3 (the dark mix of ui.css is under 4.5:1 on the dark fill)', () => {
    expect(mailbox).toMatch(/\.mb-search \{\s*--ui-placeholder: var\(--text3\);/);
    expect(ratio(DARK.text3, DARK.raised)).toBeGreaterThanOrEqual(4.5);
  });

  it('J3-03: the open folder and the open row draw their bar as an inset pill, never a border or an inset shadow on the rounded box', () => {
    expect(rule(mailbox, ".mb-nav-item[aria-current='page']")).not.toMatch(/box-shadow|border-left/);
    expect(rule(list, ".ml-row[aria-current='true']::before")).toMatch(/width: 3px;[\s\S]*border-radius: var\(--radius-pill\);/);
    expect(rule(mailbox, ".mb-nav-item[aria-current='page']::before")).toMatch(/top: 10px;[\s\S]*bottom: 10px;/);
    expect(list).not.toMatch(/inset 3px 0 0 var\(--indicator\)/);
  });

  it('J2-10: the drawer scrim fades on the duration scale (reduced motion caps it), not a millisecond literal', () => {
    expect(rule(mailbox, '.mb-drawer-scrim')).toMatch(/transition: opacity var\(--dur-gentle\) linear;/);
  });

  it('J5-02: the app draws under the status bar when installed (viewport-fit=cover), and the phone bar and the drawer keep clear of it', () => {
    expect(read('index.html')).toMatch(/<meta name="viewport" content="[^"]*viewport-fit=cover/);
    expect(rule(mailbox, '.mb-phone-bar')).toContain('env(safe-area-inset-top, 0px)');
    expect(rule(mailbox, '.mb-drawer')).toContain('env(safe-area-inset-top, 0px)');
    // The open message has no app bar: its pane takes the top inset once, and the reader's own bars never add it again (no double inset).
    expect(rule(mailbox, ".mb-root[data-layout='phone'] .mb-pane[data-pane='reader']")).toContain('env(safe-area-inset-top, 0px)');
    expect(css('reader.css')).not.toContain('safe-area-inset-top');
    // Every inset has a 0px fallback, so a browser without the variable keeps the rest of the padding.
    expect(`${mailbox}${css('reader.css')}`).not.toMatch(/env\(safe-area-inset-[a-z]+\)/);
    // The drawer leaves the sideways drag to its swipe-to-close (ui/useSwipeToDismiss).
    expect(mailbox).toMatch(/\.mb-drawer,\s*\.mb-drawer \* \{\s*touch-action: pan-y;/);
  });

  it('J4-22/J6-15: Empty Trash calls the server again while it answers `more`, adding up the count, with a bound', () => {
    const app = read('src', 'client', 'App.tsx');
    expect(app).toMatch(
      /for \(let round = 0; round < EMPTY_ROUNDS; round \+= 1\) \{[\s\S]{0,400}?deleted \+= [\s\S]{0,200}?if \(answer\.more !== true\) \{\s*break;/
    );
  });

  it('J3-05/J6-21: the phone filters are one row of chips that scrolls sideways, with the hidden edge faded', () => {
    expect(rule(list, '.ml-chiprow')).toMatch(/overflow-x: auto;/);
    expect(rule(list, '.ml-chiprow')).not.toMatch(/flex-wrap: wrap|display: grid/);
    expect(list).toMatch(/\.ml-chiprow\[data-more='end'\] \{\s*mask-image:/);
  });

  it('J6-07: compact density is two lines without an avatar, under the device preference', () => {
    expect(list).toMatch(/:root\[data-density='compact'\] \.ml-avatar \{\s*display: none;/);
  });
});
