// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT } from './helpers/scan';

// Settings (SettingsModal, AccountActivity, settings/*, security/*) is built from the ui/ primitives and the `st-*` classes of settings.css. A class
// name spelled differently in the markup and in the stylesheet draws nothing and raises no error, so the two lists are held equal here; the controls
// the redesign replaced (the hand-made switch, bare inputs, colour literals) do not come back; and the settled rules of the dialog stay in the source.

const COMPONENTS = path.join(ROOT, 'src', 'client', 'components');
const tsxIn = (dir: string): string[] =>
  readdirSync(dir)
    .filter((name) => name.endsWith('.tsx'))
    .map((name) => path.join(dir, name));
const sources = [
  path.join(COMPONENTS, 'SettingsModal.tsx'),
  path.join(COMPONENTS, 'AccountActivity.tsx'),
  ...tsxIn(path.join(COMPONENTS, 'settings')),
  ...tsxIn(path.join(COMPONENTS, 'security'))
];
const read = (file: string): string => readFileSync(file, 'utf8');
const withoutComments = (code: string): string => code.replaceAll(/\/\*[\s\S]*?\*\//g, '').replaceAll(/^\s*\/\/.*$/gm, '');
const css = read(path.join(COMPONENTS, 'settings', 'settings.css'));
const cssCode = withoutComments(css);
const words = (source: string, pattern: RegExp): Set<string> => new Set([...source.matchAll(pattern)].map((match) => match[1]));
const settings = read(path.join(COMPONENTS, 'SettingsModal.tsx'));

describe('the Settings dialog and its sections', () => {
  it('use the st-* classes that settings.css defines, and settings.css defines none that no component uses', () => {
    const used = words(sources.map(read).join('\n'), /\b(st-[a-z][a-z0-9-]*)/g);
    const defined = words(cssCode, /\.(st-[a-z][a-z0-9-]*)/g);
    expect([...used].filter((name) => !defined.has(name))).toEqual([]);
    expect([...defined].filter((name) => !used.has(name))).toEqual([]);
  });

  it('have no browser <select> or <textarea>, no bare <button>, no window.confirm or alert, no colour literal and no inline style', () => {
    for (const file of sources) {
      const code = withoutComments(read(file));
      const name = path.basename(file);
      expect(code, name).not.toMatch(/<select\b|<textarea\b|<button\b|window\.(confirm|alert)\b/);
      expect(code, name).not.toMatch(/#[0-9a-fA-F]{3,8}\b['"]|rgba?\(/);
      expect(code, name).not.toMatch(/\bstyle=\{/);
    }
  });

  it('have one bare <input> only: the hidden copy of the address for the password manager; every other field is a ui TextField', () => {
    const inputs = sources.flatMap((file) =>
      [...withoutComments(read(file)).matchAll(/<input\b[^>]*>/g)].map((match) => `${path.basename(file)} ${match[0]}`)
    );
    expect(inputs).toHaveLength(1);
    expect(inputs[0]).toMatch(/^ChangePasswordView\.tsx <input\s+type="text"\s+name="username"/);
  });

  it('is the ui Dialog at the lg size, rendered in place: no portal, so the C-7 render test sees every button', () => {
    // The props of the dialog, up to its toolbar slot (the nav).
    const dialog = settings.slice(settings.indexOf('<Dialog'), settings.indexOf('toolbar={'));
    expect(dialog).toMatch(/^<Dialog\s+inline\s/);
    expect(dialog).toMatch(/size="lg"/);
    expect(dialog).toMatch(/rootClassName="st-root"/);
    expect(dialog).toMatch(/className="st-dialog"/);
    expect(settings).not.toMatch(/createPortal|className="ui-dialog/);
    // A desktop: the nav down the left and the page on the right, each scrolling on its own, so the nav stays in view however long the
    // page is (1024x768, 1440x600); the v3 two-pane sheet is up to 1040px wide.
    const desktop = /@media \(min-width: 641px\) \{([\s\S]*?)\n\}/.exec(cssCode)?.[1] ?? '';
    expect(desktop).toMatch(
      /\.ui-dialog\.st-dialog \{[^}]*display: grid;[^}]*grid-template-columns: var\(--st-nav-w\) minmax\(0, 1fr\);[^}]*max-width: 1040px;/
    );
    expect(desktop).toMatch(/\.st-dialog > \.ui-dialog-toolbar \{[^}]*grid-column: 1;[^}]*min-height: 0;[^}]*overflow-y: auto;/);
    expect(desktop).toMatch(/\.st-dialog > \.ui-dialog-body \{[^}]*grid-column: 2;/);
    // The shell's rules live in ui/Dialog now (ui-design.test.ts): Tab is kept inside with trapTab, focus goes back to the opener, the scrim
    // closes only when the press began on it. Settings gives focus to the row of the open section in the nav (J1-07: a visible ring on a
    // keyboard open, never a field that raises a phone keyboard), and back to the drawer button when the opener is gone (it sat in the
    // phone drawer, which closes when Settings opens).
    expect(dialog).toMatch(/ref=\{dialogRef\}\s+initialFocusRef=\{navItemRef\}\s+returnFocusRef=\{NAV_TOGGLE\}/);
    expect(settings).toMatch(/querySelector<HTMLElement>\('\[role="tab"\]\[aria-selected="true"\]'\)/);
    expect(settings).toMatch(/document\.querySelector<HTMLElement>\('button\[data-nav-toggle="mailboxes"\]'\)/);
    const ui = read(path.join(ROOT, 'src', 'client', 'ui', 'Dialog.tsx'));
    expect(ui).toMatch(/trapTab\(event, panelRef\.current\)/);
    expect(ui).toMatch(/restoreFocus\(opener, returnFocusRef\)/);
    expect(ui).toMatch(/pressedOnScrim\.current = event\.target === event\.currentTarget/);
  });

  it('keeps the X a real button that a held secret disables, next to Sign out and the phone Back (C-7)', () => {
    // closeDisabled: the dialog's X is drawn disabled, and Escape and the scrim do nothing; every way out is the guarded `leave`. Settings
    // has no footer Close: the X, Escape, the scrim and a phone's Back button are the ways out.
    expect(settings).toMatch(/onClose=\{leave\}\s+closeDisabled=\{secretHeld\}/);
    const ui = read(path.join(ROOT, 'src', 'client', 'ui', 'Dialog.tsx'));
    expect(ui).toMatch(/<IconButton label=\{tr\('common\.close'\)\} size="sm" onClick=\{onClose\} disabled=\{closeDisabled\}>/);
    expect(ui).toMatch(/const canClose = dismissible && !closeDisabled;/);
    expect(settings).not.toMatch(/footer=\{/);
    expect(settings).toMatch(/disabled=\{signingOut \|\| secretHeld\}/);
    expect(settings).toMatch(/disabled: secretHeld/);
    expect(settings).toMatch(/disabled=\{secretHeld\}\s+onClick=\{\(\) => setPane\('nav'\)\}/);
  });

  it('keeps the notifications switch usable when the browser blocks notifications: only a running request disables it', () => {
    const block = /<Switch\b[\s\S]*?\/>/.exec(settings)?.[0] ?? '';
    expect(block).toMatch(/id="settings-push"/);
    expect(block).toMatch(/disabled=\{push\.busy\}/);
    expect(block).not.toMatch(/permission/);
    expect(block).toMatch(/push\.subscribed \? push\.disable\(\) : push\.enable\(\)/);
  });

  it('chooses the theme with a RadioGroup that calls the same onToggleDark, only for the other theme', () => {
    expect(settings).toMatch(
      /<RadioGroup\b[\s\S]*?value=\{t\.dark \? 'dark' : 'light'\}[\s\S]*?if \(\(value === 'dark'\) !== t\.dark\) \{\s*onToggleDark\(\);/
    );
  });

  it('draws each theme in its own palette and speaks one selection language on Appearance (v3 P1)', () => {
    // Each picture's six colours come from its own palette, per page theme (the night one is never the browser's black). FP2: on a light
    // page the night window is the night surface and raised tones (a step up, so it does not outweigh the chosen card).
    expect(cssCode).toMatch(
      /\n\.st-theme \{\s*--st-l-ground: var\(--chrome\);[^}]*--st-d-ground: color-mix\(in srgb, var\(--text\) 92%, var\(--text3\)\);\s*--st-d-sheet: color-mix\(in srgb, var\(--text\) 82%, var\(--text3\)\);/
    );
    expect(cssCode).toMatch(
      /:root\[data-theme='dark'\] \.st-theme \{\s*--st-l-ground: color-mix\(in srgb, var\(--text\) 88%, var\(--text3\)\);\s*--st-l-sheet: var\(--text\);[^}]*--st-d-ground: var\(--surface\);\s*--st-d-sheet: var\(--raised\);/
    );
    expect(cssCode).not.toMatch(/color-scheme: dark;/);
    // The chosen card and the chosen Motion / Density row: the accent's soft tint; the card adds the 2px indicator ring.
    expect(cssCode).toMatch(
      /\.st-theme \.ui-check:has\(> \.ui-radio-input:checked\) \{\s*background: var\(--accent-soft\);\s*box-shadow: inset 0 0 0 2px var\(--indicator\);/
    );
    expect(cssCode).toMatch(
      /\.ui-radio-group\.st-choices > \.ui-check:has\(> \.ui-radio-input:checked\) \{\s*background: var\(--accent-soft\);/
    );
  });

  it('ends a short page under its last group, with no decoration; the panel keeps one height (v3 P1, FP2)', () => {
    expect(settings).toMatch(/<SectionBody key=\{current\.id\}>\{contentOf\(current\)\}<\/SectionBody>/);
    // FP2: the end mark (a small FlightTrail under the last group) read as a stray doodle: gone, and nothing replaces it.
    expect(settings).toMatch(
      /function SectionBody\(\{ children \}: \{ children: React\.ReactNode \}\): React\.ReactElement \{\s*return <div className="st-section">\{children\}<\/div>;\s*\}/
    );
    expect(settings).not.toMatch(/FlightTrail|st-end-mark|END_MARK_ROOM/);
    expect(cssCode).not.toMatch(/st-end-mark/);
    expect(cssCode).toMatch(/\.ui-dialog\.st-dialog \{[^}]*height: min\(760px, 100%\);/);
  });

  it('on a phone, shows the list of sections, then one section with a way back: no row scrolls sideways or is cut, a tap opens, arrows do not', () => {
    // The nav is ui/Tabs vertical (a list down the side, Up and Down move); a click or Enter on a row opens its section on a phone
    // (onActivate), the arrows only move the selection, so moving through the list never hides it under the keyboard's focus.
    expect(settings).toMatch(/<Tabs\s+id=\{TABS_ID\}\s+className="st-tabs"\s+orientation="vertical"\s/);
    expect(settings).toMatch(/onActivate=\{\(\) => \{\s*if \(!secretHeld\) \{\s*setPane\('section'\);/);
    expect(settings).toMatch(/onClick=\{\(\) => setPane\('nav'\)\}/);
    // The open section's row carries the gliding capsule of the v3 signature (ui/glide.ts), keyed on the open section; the Tabs' own ink
    // gives way to it.
    expect(settings).toMatch(/const capsule = useGlide\(navRef, OPEN_ROW, \{ key: `\$\{openKey\} \$\{settled\}` \}\);/);
    expect(settings).toMatch(/<NavFrame pane=\{pane\} openKey=\{current\.id\}>/);
    expect(settings).toMatch(/<div ref=\{capsule\} className="ui-glide st-glide" aria-hidden="true" \/>/);
    expect(cssCode).toMatch(/\.ui-tabs\.st-tabs > \.ui-ink \{\s*display: none;/);
    const phone = /@media \(max-width: 640px\) \{([\s\S]*?)\n\}/.exec(cssCode)?.[1] ?? '';
    expect(phone).toMatch(
      /\.st-dialog:has\(\.st-nav\[data-pane='nav'\]\) > \.ui-dialog-body,\s*\.st-dialog:has\(\.st-nav\[data-pane='section'\]\) > \.ui-dialog-toolbar \{\s*display: none;/
    );
    // Big rows (56px, the icon in a tile, a chevron) on a phone; the open section's glide capsule is a desktop thing only.
    expect(phone).toMatch(/\.ui-tabs\.st-tabs > \.ui-tab,[^{]*\{[^}]*min-height: 56px;/);
    expect(phone).toMatch(/\.st-glide \{\s*display: none;/);
    // In a section a phone's head is a nav bar: Back to the list over the head, on the left; the title is kept for screen readers only.
    expect(phone).toMatch(/\.st-back \{\s*position: absolute;[^}]*display: block;/);
    expect(phone).toMatch(
      /\.st-dialog:has\(\.st-nav\[data-pane='section'\]\) > \.ui-dialog-head > \.ui-dialog-title \{[^}]*clip-path: inset\(50%\);/
    );
    // A vertical row never scrolls sideways and a long label (vi, zh-CN) wraps instead of being cut.
    const uiCss = withoutComments(read(path.join(ROOT, 'src', 'client', 'ui', 'ui.css')));
    expect(uiCss).toMatch(/\.ui-tabs\[aria-orientation='vertical'\] \{[^}]*overflow: visible;/);
    expect(uiCss).toMatch(/\.ui-tabs\[aria-orientation='vertical'\] > \.ui-tab \{[^}]*white-space: normal;/);
    // The grid of segments stays available in ui/Tabs (`grid`); the admin console's tabs are a scrolling row on a phone now (`phoneRow`).
    const uiPhone = [...uiCss.matchAll(/@media \(max-width: 640px\) \{([\s\S]*?)\n\}/g)]
      .map((match) => match[1])
      .find((block) => block.includes('ui-tabs'));
    expect(uiPhone).toMatch(
      /\.ui-tabs\[data-grid='true'\] \{[^}]*display: grid;[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);[^}]*overflow: visible;/
    );
    expect(uiPhone).toMatch(/\.ui-tabs\[data-grid='true'\] \.ui-tab \{[^}]*white-space: normal;/);
    expect(uiPhone).not.toMatch(/text-overflow|ellipsis/);
    expect(uiCss).toMatch(/@media \(max-width: 350px\) \{\s*\.ui-tabs\[data-grid='true'\] \.ui-tab \{\s*padding-inline: 4px;/);
    expect(read(path.join(ROOT, 'src', 'client', 'ui', 'Tabs.tsx'))).toMatch(/data-grid=\{grid \? 'true' : undefined\}/);
    // A short phone screen (320x568): the sheet is the whole height, so the content keeps more than half of it.
    const short = /@media \(max-width: 640px\) and \(max-height: 700px\) \{([\s\S]*?)\n\}/.exec(cssCode)?.[1] ?? '';
    expect(short).toMatch(/\.ui-dialog\.st-dialog \{[^}]*height: min\(100dvh, var\(--ui-vv-height, 100dvh\)\);[^}]*max-height: none;/);
  });

  it('puts the focus back on the button that opened a view of Security when the person goes back, or on the heading when it is gone', () => {
    const section = read(path.join(COMPONENTS, 'security', 'SecuritySection.tsx'));
    const opened = [...section.matchAll(/data-view="(\w+)"\s+onClick=\{\(\) => \{\s*open\('(\w+)'\);/g)];
    expect(opened.map((match) => match[1])).toEqual([
      'two_factor_off',
      'two_factor_on',
      'key_test',
      'key_new',
      'two_factor_codes',
      'password',
      'devices',
      'activity'
    ]);
    expect(opened.every((match) => match[1] === match[2])).toBe(true);
    expect(section).toMatch(/const back = view === null && before !== null;/);
    expect(section).toMatch(
      /const opener = back \? section\.current\?\.querySelector<HTMLElement>\(`\[data-view="\$\{CSS\.escape\(before\)\}"\]`\) : null;/
    );
    expect(section).toMatch(/\(opener \?\? heading\.current\)\?\.focus\(\);/);
  });
});
