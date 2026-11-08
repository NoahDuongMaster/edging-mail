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
    // The props of the dialog, up to its toolbar row (the tabs).
    const dialog = settings.slice(settings.indexOf('<Dialog'), settings.indexOf('toolbar={'));
    expect(dialog).toMatch(/^<Dialog\s+inline\s/);
    expect(dialog).toMatch(/size="lg"/);
    expect(dialog).toMatch(/rootClassName="st-root"/);
    expect(dialog).toMatch(/className="st-dialog"/);
    expect(settings).not.toMatch(/createPortal|className="ui-dialog/);
    // A member has no tabs: a hairline stands between the title and the content, where the row of tabs would be.
    expect(cssCode).toMatch(
      /\.st-dialog > \.ui-dialog-head \+ \.ui-dialog-body \{\s*margin-top: 16px;\s*border-top: 1px solid var\(--border\);/
    );
    // The shell's rules live in ui/Dialog now (ui-design.test.ts): Tab is kept inside with trapTab, focus goes back to the opener, the scrim
    // closes only when the press began on it. Settings gives focus to the dialog element itself, and back to the drawer button when the
    // opener is gone (it sat in the phone drawer, which closes when Settings opens).
    expect(dialog).toMatch(/ref=\{dialogRef\}\s+initialFocusRef=\{dialogRef\}\s+returnFocusRef=\{NAV_TOGGLE\}/);
    expect(settings).toMatch(/document\.querySelector<HTMLElement>\('button\[data-nav-toggle="mailboxes"\]'\)/);
    const ui = read(path.join(ROOT, 'src', 'client', 'ui', 'Dialog.tsx'));
    expect(ui).toMatch(/trapTab\(event, panelRef\.current\)/);
    expect(ui).toMatch(/restoreFocus\(opener, returnFocusRef\)/);
    expect(ui).toMatch(/pressedOnScrim\.current = event\.target === event\.currentTarget/);
  });

  it('keeps the X a real button that a held secret disables, next to the footer Close and Sign out (C-7)', () => {
    // closeDisabled: the dialog's X is drawn disabled, and Escape and the scrim do nothing; every way out is the guarded `leave`.
    expect(settings).toMatch(/onClose=\{leave\}\s+closeDisabled=\{secretHeld\}/);
    const ui = read(path.join(ROOT, 'src', 'client', 'ui', 'Dialog.tsx'));
    expect(ui).toMatch(/<IconButton label=\{tr\('common\.close'\)\} size="sm" onClick=\{onClose\} disabled=\{closeDisabled\}>/);
    expect(ui).toMatch(/const canClose = dismissible && !closeDisabled;/);
    expect(settings).toMatch(/<Button onClick=\{leave\} disabled=\{secretHeld\}>/);
    expect(settings).toMatch(/disabled=\{signingOut \|\| secretHeld\}/);
    expect(settings).toMatch(/disabled: secretHeld/);
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

  it('fits the four tabs on a phone: a 2x2 grid that never scrolls sideways and lets a long label wrap instead of cutting it', () => {
    // The grid is ui/Tabs `grid` (shared with the admin console): Settings asks for it, ui.css draws it at 640px and less.
    expect(settings).toMatch(/<Tabs\s+id=\{TABS_ID\}\s+className="st-tabs"\s+grid\s/);
    const uiCss = withoutComments(read(path.join(ROOT, 'src', 'client', 'ui', 'ui.css')));
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
    const phone = /@media \(max-width: 640px\) \{([\s\S]*?)\n\}/.exec(cssCode)?.[1] ?? '';
    // A sign-out message gets its own full-width row on a phone.
    expect(phone).toMatch(/\.st-foot-msg \{\s*order: 1;\s*flex-basis: 100%;/);
    // A short phone screen (320x568): the sheet is the whole height, so the content keeps more than half of it.
    const short = /@media \(max-width: 640px\) and \(max-height: 700px\) \{([\s\S]*?)\n\}/.exec(cssCode)?.[1] ?? '';
    expect(short).toMatch(/\.ui-dialog\.st-dialog \{[^}]*height: 100dvh;[^}]*max-height: none;/);
  });

  it('puts the focus back on the button that opened a view of Security when the person goes back, or on the heading when it is gone', () => {
    const section = read(path.join(COMPONENTS, 'security', 'SecuritySection.tsx'));
    const opened = [...section.matchAll(/data-view="(\w+)"\s+onClick=\{\(\) => \{\s*open\('(\w+)'\);/g)];
    expect(opened.map((match) => match[1])).toEqual([
      'password',
      'key_test',
      'key_new',
      'two_factor_codes',
      'two_factor_off',
      'two_factor_on'
    ]);
    expect(opened.every((match) => match[1] === match[2])).toBe(true);
    expect(section).toMatch(/const back = view === null && before !== null;/);
    expect(section).toMatch(
      /const opener = back \? section\.current\?\.querySelector<HTMLElement>\(`\[data-view="\$\{CSS\.escape\(before\)\}"\]`\) : null;/
    );
    expect(section).toMatch(/\(opener \?\? heading\.current\)\?\.focus\(\);/);
  });
});
