// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT } from './helpers/scan';

// The screens before the mailbox (components/auth/*, PasswordField, LanguagePicker) and the crash screen (ErrorBoundary) are built from the
// ui/ primitives and the `au-*` classes of auth.css. A class name spelled differently in the markup and in the stylesheet draws nothing and
// raises no error, so the two lists are held equal here; the browser controls the redesign replaced do not come back; and Edgar stays off
// the sign-in screens (the owner's decision).

const COMPONENTS = path.join(ROOT, 'src', 'client', 'components');
const AUTH = path.join(COMPONENTS, 'auth');
const sources = [
  ...readdirSync(AUTH)
    .filter((name) => name.endsWith('.tsx'))
    .map((name) => path.join(AUTH, name)),
  path.join(COMPONENTS, 'PasswordField.tsx'),
  path.join(COMPONENTS, 'LanguagePicker.tsx')
];
/** The crash screen uses the page and card of these screens (its colours are inline real values on purpose, so it is only in the class scan). */
const crash = path.join(COMPONENTS, 'ErrorBoundary.tsx');
const read = (file: string): string => readFileSync(file, 'utf8');
const code = (file: string): string =>
  read(file)
    .replaceAll(/\/\*[\s\S]*?\*\//g, '')
    .replaceAll(/^\s*\/\/.*$/gm, '');
const css = read(path.join(AUTH, 'auth.css'));
const words = (source: string, pattern: RegExp): Set<string> => new Set([...source.matchAll(pattern)].map((match) => match[1]));

describe('the screens before the mailbox', () => {
  it('use the au-* classes that auth.css defines, and auth.css defines none that no component uses', () => {
    const used = words([...sources, crash].map(read).join('\n'), /\b(au-[a-z][a-z0-9-]*)/g);
    const defined = words(css.replaceAll(/\/\*[\s\S]*?\*\//g, ''), /\.(au-[a-z][a-z0-9-]*)/g);
    expect([...used].filter((name) => !defined.has(name))).toEqual([]);
    expect([...defined].filter((name) => !used.has(name))).toEqual([]);
  });

  it('have no browser <select>, no bare <button> or <input>, no window.confirm or alert, and no inline style', () => {
    for (const file of sources) {
      expect(code(file), path.basename(file)).not.toMatch(/<select\b|<button\b|<input\b|window\.(confirm|alert)\b|\bstyle=\{/);
    }
  });

  it('show Edgar only on a screen that reports a blocked state: the small figure over the title of Setup not ready, never on a form', () => {
    const withMascot = sources.filter((file) => read(file).includes('/edgar.svg')).map((file) => path.basename(file));
    expect(withMascot).toEqual(['authUi.tsx']);
    const card = read(path.join(AUTH, 'authUi.tsx'));
    // The figure of the status screens (ui EmptyState's 112 px, its fade and its idle beats through `ui-empty-art` and useIdleBeat).
    expect(card).toMatch(
      /\{illustration \? <img ref=\{art\} src="\/edgar\.svg" alt="" width=\{112\} height=\{109\} className="au-art ui-empty-art" \/> : null\}/
    );
    expect(card).toMatch(/useIdleBeat\(art, illustration, title\)/);
    // The width stays within the 120 px the owner allows: 112 px on every screen, over a centred title (on a phone too), so the title and
    // the lead keep the whole column instead of a narrow one with an orphan word.
    expect(css).toMatch(/\.au-art \{[^}]*width: 112px;/);
    expect([...css.matchAll(/\.au-art \{[^}]*?width: (\d+)px/g)].map((match) => match[1])).toEqual(['112']);
    expect(css).toMatch(/\.au-head \{\s*display: flex;\s*flex-direction: column;/);
    expect(css).toMatch(/\.au-card\[data-status='true'\] \.au-head \{\s*align-items: center;\s*text-align: center;\s*\}/);
    const users = sources
      .filter((file) => path.basename(file) !== 'authUi.tsx' && /\billustration\b/.test(code(file)))
      .map((file) => path.basename(file));
    expect(users).toEqual(['SetupScreen.tsx']);
    expect(code(path.join(AUTH, 'SetupScreen.tsx')).match(/\billustration\b/g)).toHaveLength(1);
    expect(read(path.join(AUTH, 'SetupScreen.tsx'))).toMatch(
      /<AuthCard t=\{t\} title=\{tr\('setup\.not_ready_title'\)\}[^>]*\billustration>/
    );
  });

  it('put the language list in the bar of page actions top right, outside the card and before it, as the ui Select', () => {
    const card = read(path.join(AUTH, 'authUi.tsx'));
    const bar = card.indexOf('className="au-bar"');
    const column = card.indexOf('className="au-column"');
    const form = card.indexOf('className="au-card');
    // The bar comes first on the page (Sign out of the unlock screen, then the list: first in the tab order), the brand and the card after.
    expect(bar).toBeGreaterThan(-1);
    expect(card.indexOf('{topAction}')).toBeGreaterThan(bar);
    expect(card.indexOf('<LanguagePicker')).toBeGreaterThan(card.indexOf('{topAction}'));
    expect(card.indexOf('<LanguagePicker')).toBeLessThan(column);
    expect(column).toBeLessThan(form);
    expect(css).toMatch(/\.au-bar \{[^}]*justify-content: flex-end;/);
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

  it('let every password and key be shown before it is sent (WCAG 3.3.8): no bare password field, one Show button that says its state', () => {
    // Every secret field of these screens is a SecretField (PasswordField builds on it): masked, with a Show button in its right edge.
    for (const file of sources) {
      expect(code(file), path.basename(file)).not.toMatch(/type="password"/);
    }
    const field = code(path.join(COMPONENTS, 'PasswordField.tsx'));
    expect(field).toMatch(/type=\{shown \? 'text' : 'password'\}/);
    // One name ("Show password", or "Show key" for a setup key) and the state in aria-pressed: a name that flips says the state twice.
    expect(field).toMatch(/<IconButton label=\{showLabel \?\? tr\('password\.show'\)\} size="sm" pressed=\{shown\}/);
    expect(field).not.toContain('password.hide');
    for (const name of [
      'SignInScreen.tsx',
      'UnlockScreen.tsx',
      'GateScreens.tsx',
      'BreakGlassScreen.tsx',
      'SetupScreen.tsx',
      'ForgotScreen.tsx'
    ]) {
      expect(code(path.join(AUTH, name)), name).toMatch(/<SecretField\b/);
    }
    // The one-time code: the browser and the phone offer the code from a message or an app, and a phone opens the number pad.
    for (const name of ['SignInScreen.tsx', 'TwoFactorEnrolment.tsx']) {
      expect(code(path.join(AUTH, name)), name).toMatch(/autoComplete=\{?[^\n]*'one-time-code'|autoComplete="one-time-code"/);
      expect(code(path.join(AUTH, name)), name).toMatch(/inputMode=\{?[^\n]*'numeric'|inputMode="numeric"/);
    }
    // Nothing on these screens blocks paste.
    for (const file of sources) {
      expect(code(file), path.basename(file)).not.toMatch(/onPaste/);
    }
  });

  it('never disable a form button until every field is filled in: a press shows what is missing (only a running request and a wait disable it)', () => {
    const security = path.join(COMPONENTS, 'security');
    const forms = [
      path.join(AUTH, 'SetupScreen.tsx'),
      path.join(AUTH, 'BreakGlassScreen.tsx'),
      path.join(AUTH, 'ForgotScreen.tsx'),
      path.join(AUTH, 'GateScreens.tsx'),
      path.join(AUTH, 'SignInScreen.tsx'),
      path.join(AUTH, 'UnlockScreen.tsx'),
      path.join(AUTH, 'TwoFactorEnrolment.tsx'),
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
    // The recovery key check names the empty group under its own box; the codes panel says to tick the box under it.
    const key = code(path.join(AUTH, 'RecoveryKeyPanel.tsx'));
    expect(key).toMatch(/const toFix = firstInvalid\(typed\.map\(/);
    expect(key).toMatch(/focusLater\(toFix\);\s*return;/);
    expect(code(path.join(AUTH, 'RecoveryCodesPanel.tsx'))).toMatch(/focusLater\(SAVED_ID\);\s*return;/);
    // On every screen before the mailbox a form's button is disabled only by a wait the server asked for (and busy, inside AuthButton).
    for (const file of sources) {
      for (const match of code(file).matchAll(/<AuthButton\b[^>]*?\bdisabled=\{([^}]*)\}/g)) {
        expect(match[1], path.basename(file)).toBe('wait > 0');
      }
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

  it('centre the glow on the card (its stage), whatever the card height, and keep the column glow for the phone only', () => {
    const card = read(path.join(AUTH, 'authUi.tsx'));
    expect(card.indexOf('className="au-stage"')).toBeGreaterThan(card.indexOf('className="au-column"'));
    expect(card.indexOf('className="au-stage"')).toBeLessThan(card.indexOf('className="au-card"'));
    // The glow is the card's box grown evenly (top = bottom, left = right) with an ellipse that fills it: its centre is the card's.
    expect(css).toMatch(
      /\.au-stage::before \{[^}]*inset: -(\d+)px -(\d+)px;[^}]*background: radial-gradient\(closest-side, var\(--au-glow\), transparent\);/
    );
    const phone = css.slice(css.indexOf('@media (max-width: 480px)'));
    expect(css.slice(0, css.indexOf('@media (max-width: 480px)'))).not.toMatch(/\.au-column::after \{/);
    expect(phone).toMatch(/\.au-stage::before \{\s*display: none;\s*\}/);
    // The sign-in and unlock cards name the server and end on the trust line.
    for (const name of ['SignInScreen.tsx', 'UnlockScreen.tsx']) {
      expect(code(path.join(AUTH, name)), name).toMatch(/server="(sign-in|unlock)"/);
      expect(code(path.join(AUTH, name)), name).toMatch(/<TrustLine \/>\s*<\/AuthCard>/);
    }
  });
});
