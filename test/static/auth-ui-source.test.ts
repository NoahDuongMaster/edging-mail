// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT } from './helpers/scan';

// The screens before the mailbox (components/auth/*, PasswordField, LanguagePicker) are built from the ui/ primitives and the `au-*` classes of
// auth.css. A class name spelled differently in the markup and in the stylesheet draws nothing and raises no error, so the two lists are held
// equal here; the browser controls the redesign replaced do not come back; and Edgar stays off the sign-in screens (the owner's decision).

const COMPONENTS = path.join(ROOT, 'src', 'client', 'components');
const AUTH = path.join(COMPONENTS, 'auth');
const sources = [
  ...readdirSync(AUTH)
    .filter((name) => name.endsWith('.tsx'))
    .map((name) => path.join(AUTH, name)),
  path.join(COMPONENTS, 'PasswordField.tsx'),
  path.join(COMPONENTS, 'LanguagePicker.tsx')
];
const read = (file: string): string => readFileSync(file, 'utf8');
const code = (file: string): string =>
  read(file)
    .replaceAll(/\/\*[\s\S]*?\*\//g, '')
    .replaceAll(/^\s*\/\/.*$/gm, '');
const css = read(path.join(AUTH, 'auth.css'));
const words = (source: string, pattern: RegExp): Set<string> => new Set([...source.matchAll(pattern)].map((match) => match[1]));

describe('the screens before the mailbox', () => {
  it('use the au-* classes that auth.css defines, and auth.css defines none that no component uses', () => {
    const used = words(sources.map(read).join('\n'), /\b(au-[a-z][a-z0-9-]*)/g);
    const defined = words(css.replaceAll(/\/\*[\s\S]*?\*\//g, ''), /\.(au-[a-z][a-z0-9-]*)/g);
    expect([...used].filter((name) => !defined.has(name))).toEqual([]);
    expect([...defined].filter((name) => !used.has(name))).toEqual([]);
  });

  it('have no browser <select>, no bare <button> or <input>, no window.confirm or alert, and no inline style', () => {
    for (const file of sources) {
      expect(code(file), path.basename(file)).not.toMatch(/<select\b|<button\b|<input\b|window\.(confirm|alert)\b|\bstyle=\{/);
    }
  });

  it('show Edgar only on a screen that reports a blocked state: the small figure beside the title of Setup not ready, never on a form', () => {
    const withMascot = sources.filter((file) => read(file).includes('/edgar.svg')).map((file) => path.basename(file));
    expect(withMascot).toEqual(['authUi.tsx']);
    const card = read(path.join(AUTH, 'authUi.tsx'));
    expect(card).toMatch(/\{illustration \? <img src="\/edgar\.svg" alt="" width=\{96\} height=\{93\} className="au-art" \/> : null\}/);
    // The width stays within the 120 px the owner allows: 96 px on every screen; on a phone Edgar stands above the title, so the title and the
    // lead keep the whole column instead of a narrow one with an orphan word.
    expect(css).toMatch(/\.au-art \{[^}]*width: 96px;/);
    expect([...css.matchAll(/\.au-art \{[^}]*?width: (\d+)px/g)].map((match) => match[1])).toEqual(['96']);
    const phone = /@media \(max-width: 480px\) \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? '';
    expect(phone).toMatch(/\.au-head \{\s*flex-direction: column;\s*\}/);
    expect(phone).toMatch(/\.au-art \{\s*order: -1;\s*\}/);
    const users = sources
      .filter((file) => path.basename(file) !== 'authUi.tsx' && /\billustration\b/.test(code(file)))
      .map((file) => path.basename(file));
    expect(users).toEqual(['SetupScreen.tsx']);
    expect(code(path.join(AUTH, 'SetupScreen.tsx')).match(/\billustration\b/g)).toHaveLength(1);
    expect(read(path.join(AUTH, 'SetupScreen.tsx'))).toMatch(
      /<AuthCard t=\{t\} title=\{tr\('setup\.not_ready_title'\)\}[^>]*\billustration>/
    );
  });

  it('put the language list on the row over the card (as wide as the card), outside the card, as the ui Select', () => {
    const card = read(path.join(AUTH, 'authUi.tsx'));
    const column = card.indexOf('className="au-column"');
    const top = card.indexOf('className="au-top"');
    const form = card.indexOf('className="au-card');
    // Inside the column (so its right edge is the card's), before the card; in the page's corner it overshot the card by the page margin.
    expect(column).toBeGreaterThan(-1);
    expect(top).toBeGreaterThan(column);
    expect(card.indexOf('<LanguagePicker')).toBeGreaterThan(top);
    expect(card.indexOf('<LanguagePicker')).toBeLessThan(form);
    expect(card).not.toContain('au-corner');
    expect(read(path.join(COMPONENTS, 'LanguagePicker.tsx'))).toContain('<Select');
    expect(read(path.join(AUTH, 'SetupScreen.tsx'))).toContain('<Select');
  });

  it('show the missing secrets of Setup not ready as a warning with their names in mono, and what to do as numbered steps', () => {
    const setup = read(path.join(AUTH, 'SetupScreen.tsx'));
    expect(setup).toMatch(/<Banner tone="warning" title=\{tr\('setup\.not_ready_list', \{ count \}\)\}>/);
    expect(setup).toMatch(/<code translate="no" className="nm-mono au-secret">/);
    // The steps are the ui Steps: an ordered list (a real <ol>) numbered in small circles by ui.css. Step 1 links to the deployment guide
    // (the landing page's link, one constant for a fork to change); what APP_PASSWORD is, a fact and not a step, is a note after the list.
    expect(setup).toMatch(/<Steps>\s*<Step>\{tRich\('setup\.not_ready_step_add', \{ guide \}, \{ count \}\)\}<\/Step>/);
    expect(setup).toMatch(/<a href=\{DEPLOY_GUIDE_URL\} target="_blank" rel="noreferrer" className="au-link">/);
    expect(setup).toMatch(/<\/Steps>\s*\{names\.includes\(SETUP_KEY_SECRET\) \? \(\s*<p className="au-muted">/);
    expect(read(path.join(ROOT, 'src', 'client', 'ui', 'Steps.tsx'))).toMatch(/<ol role="list" className=\{cx\('ui-steps', className\)\}>/);
    expect(read(path.join(ROOT, 'src', 'client', 'ui', 'ui.css'))).toMatch(/\.ui-step::before \{[^}]*content: counter\(ui-step\);/);
  });

  it('draw the strength meter as four thin segments with the words under it', () => {
    const field = read(path.join(COMPONENTS, 'PasswordField.tsx'));
    expect(field).toContain('role="meter"');
    expect(field).toMatch(/\[1, 2, 3, 4\]\.map/);
    expect(field).toMatch(/<p id=\{`\$\{id\}-status`\} aria-live="polite"/);
    expect(css).toMatch(/\.au-meter-seg \{[^}]*height: 4px;/);
  });

  it('make a way back (Back, Cancel) of the recovery key a quiet text button, and keep Copy and Download one pair of secondary buttons with icons', () => {
    const key = code(path.join(AUTH, 'RecoveryKeyPanel.tsx'));
    expect(key).toMatch(
      /<div className="au-alt">\s*<TextButton t=\{t\} label=\{cancelLabel \?\? tr\('common\.cancel'\)\} onClick=\{onCancel\} disabled=\{busy\} \/>/
    );
    expect(key).not.toMatch(/<AuthButton[^>]*\bonClick=\{onCancel\}/);
    // The enrolment's Cancel (Settings) is the same quiet text button, not a full-width bordered one.
    const enrolment = code(path.join(AUTH, 'TwoFactorEnrolment.tsx'));
    expect(enrolment).toMatch(
      /<div className="au-alt">\s*<TextButton t=\{t\} label=\{tr\('common\.cancel'\)\} onClick=\{onCancel\} disabled=\{confirm\.busy\} \/>/
    );
    expect(enrolment).not.toMatch(/<AuthButton[^>]*\bonClick=\{onCancel\}/);
    for (const name of ['RecoveryKeyPanel.tsx', 'RecoveryCodesPanel.tsx']) {
      const panel = code(path.join(AUTH, name));
      expect(panel, name).toMatch(
        /<div className="au-actions">\s*<CopyButton[\s\S]*?\/>\s*<AuthButton\s+t=\{t\}\s+type="button"\s+quiet\s+icon=\{<Download size=\{16\} aria-hidden="true" \/>\}/
      );
    }
  });

  it('never disable a form button until every field is filled in: a press shows what is missing (only a running request and a wait disable it)', () => {
    const security = path.join(COMPONENTS, 'security');
    const forms = [
      path.join(AUTH, 'SetupScreen.tsx'),
      path.join(AUTH, 'BreakGlassScreen.tsx'),
      path.join(AUTH, 'ForgotScreen.tsx'),
      path.join(AUTH, 'GateScreens.tsx'),
      path.join(security, 'ChangePasswordView.tsx'),
      path.join(security, 'CredentialForm.tsx')
    ];
    for (const file of forms) {
      const source = code(file);
      const name = path.basename(file);
      expect(source, name).not.toMatch(/\b(ready|valid)\b/);
      // The press reaches the handler, which shows every error (submitted / all touched) and moves the keyboard to the first field to fix.
      expect(source, name).toMatch(/const toFix = firstInvalid\(\[/);
      expect(source, name).toMatch(/focusLater\(toFix\);\s*return;/);
    }
    expect(code(path.join(AUTH, 'SetupScreen.tsx'))).toMatch(/<AuthButton t=\{t\} busy=\{starting\} label=\{tr\('gate\.continue'\)\} \/>/);
    expect(code(path.join(security, 'ChangePasswordView.tsx'))).toMatch(
      /<AuthButton t=\{t\} busy=\{action\.busy\} disabled=\{wait > 0\} label=\{tr\('security\.change_password'\)\} \/>/
    );
    const credential = code(path.join(security, 'CredentialForm.tsx'));
    expect(credential).toMatch(/disabled=\{action\.busy \|\| wait > 0\}/);
    expect(credential).toMatch(/<AuthButton t=\{t\} busy=\{action\.busy\} disabled=\{wait > 0\} label=\{submitLabel\} \/>/);
    // The focused field is scrolled above Setup's docked Continue bar: the page keeps that much scroll padding, and the scroll honours it.
    expect(css).toMatch(/html:has\(\.au-sticky\) \{\s*scroll-padding-bottom: 96px;\s*\}/);
    const focus = read(path.join(ROOT, 'src', 'client', 'lib', 'fieldFocus.ts'));
    expect(focus).toMatch(/input\.focus\(\{ preventScroll: true \}\);/);
    expect(focus.match(/scrollIntoView\(\{ block: 'nearest' \}\)/g)).toHaveLength(2);
  });
});
