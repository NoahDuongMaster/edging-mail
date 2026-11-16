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

  it('J1-03 (v3): Compose names its C key in its tooltip and aria-keyshortcuts, only while single-key shortcuts are on (no keycap on the pill)', () => {
    const sidebar = read('src', 'client', 'components', 'Sidebar.tsx');
    expect(sidebar).not.toContain('<Kbd');
    expect(sidebar).toContain('const keyHint = singleKeys && onCloseMobile === undefined;');
    expect(sidebar).toMatch(/aria-keyshortcuts=\{keyHint \? COMPOSE_KEY : undefined\}/);
    expect(sidebar).toContain('open={tip.open ? keyHint : false}');
    expect(sidebar).toMatch(/text=\{`\$\{tr\('action\.compose'\)\} \(\$\{COMPOSE_KEY\}\)`\}/);
    // The pill itself (lead review 1): TONAL, the accent tint with the accent text (6.5:1 or more in both themes), hover and press a deeper
    // tint; the phone's Compose wears the same; neither is a primary (Reply stays the one filled blue).
    expect(sidebar).toMatch(/variant="secondary"\s+shape="pill"/);
    expect(read('src', 'client', 'App.tsx')).toMatch(/ref=\{homeRef\('compose'\)\}\s+variant="secondary"\s+shape="pill"/);
    expect(mailbox).toMatch(/\.mb-root \.mb-compose\.ui-btn\[data-size\] \{[^}]*border-radius: var\(--radius-pill\);/);
    expect(rule(mailbox, '.mb-root .mb-compose.ui-btn[data-size]')).toMatch(
      /background: var\(--accent-soft\);\s*color: var\(--accent-text\);/
    );
    expect(rule(mailbox, '.mb-root .mb-fab.ui-btn[data-size]')).toMatch(/background: var\(--mb-fab-fill\);\s*color: var\(--accent-text\);/);
    // The same tint (the dark theme takes a step more of the accent, 24%, so the floating button reads over the dark list).
    expect(mailbox).toMatch(/--mb-fab-fill: var\(--accent-soft\);/);
    expect(mailbox).toMatch(/--mb-fab-fill: color-mix\(in srgb, var\(--accent\) 24%, var\(--surface\)\);/);
    expect(mailbox).toMatch(/--mb-tonal-hover: color-mix\(in srgb, var\(--accent\) 18%, var\(--surface\)\);/);
    expect(mailbox).toMatch(/--mb-fab-h: 48px;/);
    // The phone's floating shadow is the token itself, on a plate under the clipped button, after a 6px ring of the list's surface (the
    // notch that keeps a row's glyphs from peeking round the button's rounded corners).
    expect(rule(mailbox, '.mb-fab-wrap::before')).toMatch(/box-shadow:\s*0 0 0 6px var\(--surface\),\s*var\(--float-shadow\);/);
    for (const palette of [LIGHT, DARK]) {
      expect(ratio(palette.accentText, palette.accentSoft)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('J1-04: the search placeholder is text3 (the dark mix of ui.css is under 4.5:1 on the dark fill)', () => {
    expect(mailbox).toMatch(/\.mb-search \{\s*--ui-placeholder: var\(--text3\);/);
    expect(ratio(DARK.text3, DARK.raised)).toBeGreaterThanOrEqual(4.5);
  });

  it('J3-03 (v3): the open folder is told by three cues (the gliding capsule, the weight, the accent icon), the open row by its capsule and an inset pill, never a border or an inset shadow on the rounded box', () => {
    expect(rule(mailbox, ".mb-nav-item[aria-current='page']")).not.toMatch(/box-shadow|border-left/);
    expect(rule(mailbox, ".mb-nav-item[aria-current='page']")).toMatch(/font-weight: 600;/);
    expect(rule(mailbox, ".mb-nav-item[aria-current='page'] .mb-nav-icon")).toMatch(/color: var\(--accent\);/);
    expect(rule(mailbox, '.mb-nav-glide')).toMatch(/background: var\(--surface\);[\s\S]*box-shadow: var\(--sheet-shadow\);/);
    // Before the capsule is placed (or without :has) the open folder draws the same capsule itself.
    expect(mailbox).toMatch(
      /\.mb-rail-nav:not\(:has\(> \.ui-glide:not\(\[hidden\]\):is\(\[style\], \[data-placed\]\)\)\) \.mb-nav-item\[aria-current='page'\] \{/
    );
    expect(rule(list, ".ml-row[aria-current='true']::before")).toMatch(/width: 3px;[\s\S]*border-radius: var\(--radius-pill\);/);
    expect(rule(list, '.ml-glide::before')).toMatch(
      /width: 3px;[\s\S]*border-radius: var\(--radius-pill\);[\s\S]*background: var\(--indicator\);/
    );
    expect(list).not.toMatch(/inset 3px 0 0 var\(--indicator\)/);
  });

  it('v3 4.1: no header on a desktop; two floating sheets (radius-sheet, sheet shadow, no border) 12px apart on the window ground', () => {
    expect(mailbox).not.toContain('.mb-header');
    expect(mailbox).toMatch(/--mb-gap: 12px;/);
    expect(rule(mailbox, ".mb-root[data-layout='desktop'] .mb-pane")).toMatch(
      /border-radius: var\(--radius-sheet, 18px\);[\s\S]*box-shadow: var\(--sheet-shadow\);/
    );
    expect(rule(mailbox, ".mb-root[data-layout='desktop'] .mb-pane")).not.toMatch(/border:/);
    expect(rule(mailbox, '.mb-panes')).toMatch(/gap: var\(--mb-gap\);/);
    const app = read('src', 'client', 'App.tsx');
    expect(app).not.toContain('className="mb-header"');
    // The account (the one way into Settings) and the theme switch stand at the rail's foot; the search is the list sheet's.
    expect(app).toMatch(/foot=\{railFoot\}/);
    expect(app).toMatch(/className="mb-account-row" data-account-button=""/);
    expect(app).toContain('searchSlot={renderSearch(false)}');
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

  it('W5 lead review 11/12: the rail content ends 16px before the list sheet; the phone fades only the band behind Compose', () => {
    expect(mailbox).toMatch(
      /\.mb-sidebar:not\(\[data-drawer\]\) :is\(\.mb-compose-wrap, \.mb-sidebar-scroll, \.mb-rail-foot\) \{\s*padding-right: 16px;/
    );
    expect(mailbox).toMatch(/--mb-rail-w: clamp\(232px, 14vw \+ 72px, 272px\);/);
    // The band: the button and 28px over its top edge (96px without a home indicator); rows at 75 % at its top edge, 30 % at the foot.
    expect(mailbox).toMatch(
      /--ml-fab-top: calc\(var\(--mb-fab-h\) \+ var\(--mb-fab-bottom\)\);\s*--ml-fab-fade: calc\(var\(--ml-fab-top\) \+ 28px\);/
    );
    expect(mailbox).toMatch(/--ml-fab-mid: 60%;\s*--ml-fab-low: 40%;\s*--ml-fab-floor: 30%;/);
    expect(mailbox).not.toContain('--ml-fab-gone');
  });
});
