// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT } from './helpers/scan';

// v4m wave 1 (DESIGN-v4m R2-R4) as source facts: the type sizes are variables with phone values that never go under 13 px, the library's
// own rules use them instead of numbers, the new pieces honour reduced motion, and the keyboard decision (visualViewport, no viewport-meta
// change) holds. The looks and the measured behaviour were checked in the lab; what a file scan can hold is held here.

const read = (...parts: string[]): string => readFileSync(path.join(ROOT, ...parts), 'utf8');
const strip = (css: string): string => css.replaceAll(/\/\*[\s\S]*?\*\//g, '');
const ui = strip(read('src', 'client', 'ui', 'ui.css'));
const signature = strip(read('src', 'client', 'ui', 'signature.css'));
const PHONE = '@media (max-width: 640px), (pointer: coarse) {';

/** The bodies of every block opened by `opening` (a media query), to its matching brace. */
function blocks(css: string, opening: string): string[] {
  const out: string[] = [];
  for (let at = css.indexOf(opening); at !== -1; at = css.indexOf(opening, at + 1)) {
    let depth = 0;
    let end = at + opening.length - 1;
    for (; end < css.length; end += 1) {
      if (css[end] === '{') {
        depth += 1;
      } else if (css[end] === '}') {
        depth -= 1;
        if (depth === 0) {
          break;
        }
      }
    }
    out.push(css.slice(at + opening.length, end));
  }
  return out;
}

/** The selectors (last line of each) of the rules in `css` that set a font size in px. */
const literal = (css: string): string[] =>
  [...css.matchAll(/([^{}]+)\{[^}]*?font-size:\s*[\d.]+px/g)].map((match) => match[1].trim().split('\n').pop() ?? '');

/** `--name: value;` pairs of the first `:root {` rule inside `css`. */
function rootVars(css: string): Map<string, string> {
  const body = /:root \{([^}]*)\}/.exec(css)?.[1] ?? '';
  return new Map([...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((match) => [match[1], match[2].trim()]));
}

const TYPE: Record<string, [desktop: string, phone: string]> = {
  '--fs-body': ['14px', '16px'],
  '--lh-body': ['20px', '24px'],
  '--fs-secondary': ['13px', '15px'],
  '--lh-secondary': ['20px', '22px'],
  '--fs-label': ['13px', '15px'],
  '--lh-label': ['20px', '20px'],
  '--fs-meta': ['12px', '13px'],
  '--lh-meta': ['16px', '18px'],
  '--fs-button': ['14px', '16px'],
  '--fs-button-sm': ['13px', '15px'],
  '--fs-title': ['18px', '20px'],
  '--lh-title': ['26px', '28px'],
  '--fs-tip': ['14px', '15px'],
  '--lh-tip': ['20px', '22px']
};

describe('type on phones (DESIGN-v4m R2)', () => {
  const desktop = rootVars(ui);
  const phoneBlocks = blocks(ui, PHONE);
  const phone = rootVars(phoneBlocks.join('\n'));

  it('defines every type variable with the desktop value and the phone/touch value of the table', () => {
    for (const [name, [onDesktop, onPhone]] of Object.entries(TYPE)) {
      expect(desktop.get(name), name).toBe(onDesktop);
      expect(phone.get(name), name).toBe(onPhone);
    }
    // 16 px text in a field on a phone (iOS does not zoom in), and 48 px form fields there (44 px buttons stay the touch minimum).
    expect(phone.get('--ui-field-size')).toBe('16px');
    expect(phone.get('--ui-h-field')).toBe('calc(var(--control-touch) + 4px)');
  });

  it('never sets a font size under 13 px on a phone: the variables, and no literal size in any phone block of ui.css', () => {
    for (const name of Object.keys(TYPE).filter((key) => key.startsWith('--fs-'))) {
      expect(Number.parseFloat(phone.get(name) ?? '0'), name).toBeGreaterThanOrEqual(13);
    }
    for (const block of [...phoneBlocks, ...blocks(ui, '@media (max-width: 640px) {')]) {
      const sizes = [...block.matchAll(/font-size:\s*([\d.]+)px/g)].map((match) => Number(match[1]));
      expect(sizes.filter((size) => size < 13)).toEqual([]);
    }
  });

  it("writes no literal font size in the library's rules, except avatar initials and aria-hidden decorations (postmark, flight badge)", () => {
    expect(literal(ui).filter((selector) => !selector.includes('.ui-avatar'))).toEqual([]);
    expect(literal(signature).every((selector) => /ui-postmark|ui-homing/.test(selector))).toBe(true);
    // Labels, hints, errors, buttons, menus, tabs, badges, dialogs and toasts read the variables.
    expect(ui).toMatch(/\.ui-label \{\s*font-size: var\(--fs-label\);\s*line-height: var\(--lh-label\);/);
    expect(ui).toMatch(/\.ui-hint \{\s*font-size: var\(--fs-secondary\);/);
    expect(ui).toMatch(/\.ui-dialog-title \{[^}]*font-size: var\(--fs-title\);/);
    expect(ui).toMatch(/\.ui-btn\[data-size='sm'\] \{[^}]*font-size: var\(--fs-button-sm\);/);
  });
});

describe('the v4m primitives in ui.css', () => {
  it('gives the InfoTip a 24 px target with a mouse and 44 px on touch, taken back with negative margins on one line', () => {
    expect(ui).toMatch(
      /\.ui-infotip,\s*\.ui-infotip\[data-size\] \{[^}]*--ui-tip-box: 24px;[^}]*margin-block: calc\(\(1lh - var\(--ui-tip-box\)\) \/ 2\);/
    );
    expect(blocks(ui, PHONE).join('\n')).toMatch(/\.ui-infotip,\s*\.ui-infotip\[data-size\] \{\s*--ui-tip-box: 44px;/);
    // The bubble never runs off a 320 px screen and its words are the tip size.
    expect(ui).toMatch(
      /\.ui-popover\.ui-infotip-bubble \{[^}]*max-width: min\(300px, calc\(100vw - 16px\)\);[^}]*font-size: var\(--fs-tip\);/
    );
  });

  it("keeps the dialog head and foot while the body scrolls on a phone, with the foot's hairline, fade and safe area", () => {
    const phoneSheet = blocks(ui, '@media (max-width: 640px) {').join('\n');
    expect(phoneSheet).toMatch(
      /\.ui-dialog\[data-scrolled='true'\] > :has\(\+ \.ui-dialog-body\) \{[^}]*box-shadow: 0 1px 0 var\(--border\);/
    );
    expect(phoneSheet).toMatch(
      /\.ui-dialog\[data-scrolls='true'\] > \.ui-dialog-foot \{[^}]*padding-bottom: calc\(16px \+ env\(safe-area-inset-bottom\)\);[^}]*box-shadow: inset 0 1px 0 var\(--border\);/
    );
    expect(phoneSheet).toMatch(/\.ui-dialog\[data-scrolls='true'\] > \.ui-dialog-foot::before \{[^}]*height: 16px;/);
    expect(read('src', 'client', 'ui', 'Dialog.tsx')).toContain("data-scrolls={bodyScrolls ? 'true' : undefined}");
  });

  it('docks the ActionBar sticky above the keyboard inset, with a hairline and a 16 px fade, and pins the PhoneBar to the top', () => {
    expect(ui).toMatch(
      /\.ui-actionbar\[data-docked='true'\] \{[^}]*position: sticky;[^}]*bottom: var\(--ui-actionbar-bottom, var\(--ui-actionbar-auto-bottom, var\(--ui-vv-bottom, 0px\)\)\);/
    );
    expect(ui).toMatch(/\.ui-actionbar\[data-docked='true'\]::before \{[^}]*height: 16px;/);
    expect(ui).toMatch(/\.ui-phonebar \{[^}]*position: sticky;[^}]*top: 0;[^}]*min-height: calc\(56px \+ env\(safe-area-inset-top\)\);/);
    expect(ui).toMatch(/\.ui-phonebar\[data-scrolled='true'\] \{\s*box-shadow: 0 1px 0 var\(--border\);/);
  });

  it('gives inline text buttons a 44 px touch box that moves no text', () => {
    expect(ui).toMatch(
      /:is\(\.ui-btn, \.ui-disclosure\)\[data-inline='true'\] \{[^}]*margin-block: calc\(\(1lh - var\(--ui-inline-box\)\) \/ 2\);/
    );
    expect(blocks(ui, PHONE).join('\n')).toMatch(/:is\(\.ui-btn, \.ui-disclosure\)\[data-inline='true'\] \{\s*--ui-inline-box: 44px;/);
  });

  it('lets reduced motion stop the new transitions (the tip glyph, the bar hairline)', () => {
    const reduced = blocks(ui, '@media (prefers-reduced-motion: reduce) {').join('\n');
    expect(reduced).toMatch(/\.ui-infotip,\s*\.ui-phonebar \{\s*transition: none;/);
    expect(ui).toMatch(/:root\[data-motion='reduce'\] :is\([^)]*\.ui-infotip, \.ui-phonebar\) \{\s*transition: none;/);
  });
});

describe('the keyboard decision (DESIGN-v4m R3)', () => {
  it('keeps the viewport meta as it was (no interactive-widget) and lifts docked bars with visualViewport instead', () => {
    const meta = /<meta name="viewport" content="([^"]+)"/.exec(read('index.html'))?.[1];
    expect(meta).toBe('width=device-width, initial-scale=1.0, viewport-fit=cover');
    const bar = read('src', 'client', 'ui', 'ActionBar.tsx');
    expect(bar).toContain('window.visualViewport');
    expect(bar).toContain("root.style.setProperty('--ui-vv-bottom'");
  });

  it('makes the InfoTip a passive layer over a dialog (Escape closes the tip first; the dialog keeps trapping Tab)', () => {
    const tip = read('src', 'client', 'ui', 'InfoTip.tsx');
    expect(tip).toMatch(/<Popover[\s\S]*?\bpassive\b/);
    expect(tip).toContain("tr('ui.info_about', { label })");
    expect(read('src', 'client', 'ui', 'layers.ts')).toContain('stack.slice(at + 1).every((above) => above.passive)');
  });
});
