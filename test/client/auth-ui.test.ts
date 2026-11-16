import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PasswordField } from '../../src/client/components/PasswordField';
import { BreakGlassScreen } from '../../src/client/components/auth/BreakGlassScreen';
import { RecoveryCodesPanel } from '../../src/client/components/auth/RecoveryCodesPanel';
import { SetupScreen } from '../../src/client/components/auth/SetupScreen';
import { SignInScreen } from '../../src/client/components/auth/SignInScreen';
import { UnlockScreen } from '../../src/client/components/auth/UnlockScreen';
import { ErrorBoundary } from '../../src/client/components/ErrorBoundary';
import { AuthButton, AuthSteps, CheckboxRow, HintedLink, TextButton, TrustLine } from '../../src/client/components/auth/authUi';
import { ChangePasswordView } from '../../src/client/components/security/ChangePasswordView';
import { CredentialForm } from '../../src/client/components/security/CredentialForm';
import type { SessionUser } from '../../src/client/lib/auth';
import type { PasswordCheck } from '../../src/client/lib/password/usePasswordCheck';
import { getTokens } from '../../src/client/theme';

// Small pieces of the screens before the mailbox that truong's walker measures (C-9b, C-11, C-12), rendered on the server side of React.

const t = getTokens(false);

function nothing(): void {
  // A handler the test never calls.
}

describe('AuthButton', () => {
  it('says that it is busy to a screen reader, whatever the animation does (C-11: no animation under reduced motion)', () => {
    const busy = renderToStaticMarkup(createElement(AuthButton, { t, label: 'Continue', busy: true }));
    expect(busy).toContain('aria-busy="true"');
    expect(busy).toContain('nm-spin');
    // Busy is also disabled, as before the redesign: a second press does nothing.
    expect(busy).toMatch(/<button[^>]*\bdisabled=""/);
    const idle = renderToStaticMarkup(createElement(AuthButton, { t, label: 'Continue' }));
    expect(idle).toContain('aria-busy="false"');
    expect(idle).not.toContain('nm-spin');
    expect(idle).toContain('type="submit"');
  });

  it('is the primary button of the screen, or the secondary one when quiet, 44 px high (size lg)', () => {
    const primary = renderToStaticMarkup(createElement(AuthButton, { t, label: 'Continue' }));
    expect(primary).toContain('data-variant="primary"');
    expect(primary).toContain('data-size="lg"');
    const quiet = renderToStaticMarkup(createElement(AuthButton, { t, label: 'Copy', quiet: true, type: 'button' }));
    expect(quiet).toContain('data-variant="secondary"');
    expect(quiet).toContain('type="button"');
    expect(quiet).not.toContain('<svg');
  });

  it('puts an icon before the label when it is given one (Download beside Copy), and the spinner in its place while busy', () => {
    const icon = createElement('svg', { 'data-icon': 'download', 'aria-hidden': 'true' });
    const html = renderToStaticMarkup(createElement(AuthButton, { t, label: 'Download', quiet: true, type: 'button', icon }));
    expect(html.indexOf('data-icon="download"')).toBeGreaterThan(-1);
    expect(html.indexOf('data-icon="download"')).toBeLessThan(html.indexOf('Download<'));
    const busy = renderToStaticMarkup(createElement(AuthButton, { t, label: 'Download', quiet: true, type: 'button', icon, busy: true }));
    expect(busy).not.toContain('data-icon="download"');
    expect(busy).toContain('nm-spin');
  });
});

describe('TextButton', () => {
  it('is at least 44 px high and 44 px wide, so a short label (vi "Hủy", zh "返回") is still a tap target (C-12)', () => {
    for (const label of ['Hủy', '返回', 'Back']) {
      const html = renderToStaticMarkup(createElement(TextButton, { t, label, onClick: nothing }));
      // size lg = --ui-h-lg, the 44 px touch height on every screen; au-text-btn keeps min-height and a 44 px min-width (auth.css, see
      // test/static/client-contracts.test.ts C-12).
      expect(html, label).toContain('data-size="lg"');
      expect(html, label).toMatch(/class="[^"]*\bau-text-btn\b/);
      expect(html, label).toContain('type="button"');
    }
  });

  it('keeps the name the tests find it by', () => {
    const html = renderToStaticMarkup(createElement(TextButton, { t, label: 'Sign out', onClick: nothing, action: 'unlock-sign-out' }));
    expect(html).toContain('data-action="unlock-sign-out"');
  });
});

describe('CheckboxRow', () => {
  it('is one label round the box, its name and its hint (C-12), named by the label alone and described by the hint', () => {
    const html = renderToStaticMarkup(
      createElement(CheckboxRow, { t, id: 'row', label: 'Shared device', hint: 'Stays in this tab', checked: false, onChange: nothing })
    );
    expect(html).toMatch(/^<label class="ui-check"/);
    expect(html.match(/<label/g)).toHaveLength(1);
    expect(html).toMatch(/<input[^>]*type="checkbox"/);
    expect(html).toContain('aria-labelledby="row-label"');
    expect(html).toContain('aria-describedby="row-hint"');
    expect(html).toContain('id="row-label"');
    expect(html).toContain('id="row-hint"');
    expect(html.indexOf('<input')).toBeLessThan(html.indexOf('Shared device'));
    expect(html.indexOf('Shared device')).toBeLessThan(html.indexOf('Stays in this tab'));
    expect(html).toMatch(/<\/label>$/);
  });

  it('is ticked and disabled when the choice is locked', () => {
    const html = renderToStaticMarkup(
      createElement(CheckboxRow, { t, id: 'row', label: 'A', hint: 'B', checked: true, onChange: nothing, locked: true })
    );
    const box = /<input[^>]*>/.exec(html)?.[0] ?? '';
    expect(box).toMatch(/\bchecked\b/);
    expect(box).toMatch(/\bdisabled\b/);
  });
});

describe('RecoveryCodesPanel', () => {
  it('has a heading that script can focus without making it a stop of the Tab key (C-9b)', () => {
    const html = renderToStaticMarkup(createElement(RecoveryCodesPanel, { t, codes: ['aaaa-bbbb', 'cccc-dddd'], onDone: nothing }));
    expect(html).toMatch(/<h2[^>]*tabindex="-1"/);
    expect(html).toContain('aaaa-bbbb');
    // Nothing else in the panel has a positive tab index, and the heading is the first thing in it.
    expect(html).not.toMatch(/tabindex="[1-9]/);
    expect(html.indexOf('<h2')).toBeLessThan(html.indexOf('<ol'));
  });

  it('can be pressed before the box is ticked: Continue is never disabled, the press says to tick the box (the settled pattern)', () => {
    const html = renderToStaticMarkup(createElement(RecoveryCodesPanel, { t, codes: ['aaaa-bbbb'], onDone: nothing }));
    const tag = /<button[^>]*>(?:(?!<\/button>)[\s\S])*Continue<\/button>/.exec(html)?.[0] ?? '';
    expect(tag).toContain('type="button"');
    expect(tag).not.toMatch(/\bdisabled=""/);
    expect(html).not.toContain('twofa-codes-saved-error');
  });

  it('takes the level of its heading from where it is shown (an h5 under a view of Settings), and that heading still takes the focus (C-9b)', () => {
    const html = renderToStaticMarkup(createElement(RecoveryCodesPanel, { t, codes: ['aaaa-bbbb'], onDone: nothing, headingLevel: 5 }));
    expect(html).toMatch(/<h5[^>]*tabindex="-1"[^>]*class="au-subtitle"/);
    expect(html).not.toContain('<h2');
  });
});

// A form's button is not disabled until every field is filled in: a disabled button never says what it waits for. It can be pressed on an empty
// form, and the press shows each field's error and moves the keyboard to the first (that part needs a browser). It stays disabled only for a real
// reason: a request that runs (busy) or a wait the server asked for.

const USER: SessionUser = {
  id: 'u1',
  email: 'dana@example.com',
  display_name: 'Dana',
  role: 'member',
  must_change_password: false,
  has_keys: true,
  totp_enabled: true,
  require_2fa: false,
  two_factor_reset_due_at: null,
  admin_password_upgrade_required: false,
  step_up_at: 0
};

/** A screen as the browser first sees it; the password check's data has not loaded (the server never fetches it). */
const page = (element: ReactElement): string =>
  renderToStaticMarkup(createElement(QueryClientProvider, { client: new QueryClient() }, element));

/** The opening tag of the button whose text is `label`. */
const buttonTag = (html: string, label: string): string => {
  const end = html.indexOf(`${label}</button>`);
  expect(end, label).toBeGreaterThan(-1);
  const start = html.lastIndexOf('<button', end);
  return html.slice(start, html.indexOf('>', start) + 1);
};

describe('a form whose button is always pressable', () => {
  it('Sign in: the button can be pressed on the empty form, both fields can show their password managers what they are, no error yet', () => {
    const html = page(createElement(SignInScreen, { t, onForgot: nothing }));
    const button = buttonTag(html, 'Sign in');
    expect(button).toContain('type="submit"');
    expect(button).not.toMatch(/\bdisabled=""/);
    expect(html).not.toContain('role="alert"');
    expect(html).not.toContain('aria-invalid="true"');
    expect(html).toMatch(
      /<input[^>]*id="signin-email"[^>]*autoComplete="username"|<input[^>]*autoComplete="username"[^>]*id="signin-email"/i
    );
    const password = /<input[^>]*id="signin-password"[^>]*>/.exec(html)?.[0] ?? '';
    expect(password).toContain('type="password"');
    expect(password.toLowerCase()).toContain('autocomplete="current-password"');
    // The Show button of the password: one name, the state in aria-pressed.
    expect(html).toMatch(
      /<button[^>]*aria-label="Show password"[^>]*aria-pressed="false"|<button[^>]*aria-pressed="false"[^>]*aria-label="Show password"/
    );
  });

  it('Unlock: the button can be pressed with the password empty', () => {
    const user: SessionUser = { ...USER, has_keys: true };
    const html = page(createElement(UnlockScreen, { t, user }));
    expect(buttonTag(html, 'Unlock')).not.toMatch(/\bdisabled=""/);
    expect(html).not.toContain('role="alert"');
  });

  it('Setup: Continue is a submit button that can be pressed on the empty form, and no field shows an error before anything was done', () => {
    const html = page(
      createElement(SetupScreen, { t, session: { authenticated: false, setup_required: true, configured: true, missing_secrets: [] } })
    );
    const button = buttonTag(html, 'Continue');
    expect(button).toContain('type="submit"');
    expect(button).not.toMatch(/\bdisabled=""/);
    expect(button).not.toContain('aria-disabled');
    expect(html).not.toContain('role="alert"');
    expect(html).not.toContain('aria-invalid="true"');
    // Every field the press can name has the id the focus moves to.
    for (const id of ['setup-key', 'setup-email', 'setup-name', 'setup-password', 'setup-confirm']) {
      expect(html, id).toMatch(new RegExp(`<input[^>]*id="${id}"`));
    }
  });

  it('Restore an admin account: Continue can be pressed on the empty form, with no error shown yet', () => {
    const html = page(createElement(BreakGlassScreen, { t, onBack: nothing }));
    expect(buttonTag(html, 'Continue')).not.toMatch(/\bdisabled=""/);
    expect(html).not.toContain('role="alert"');
  });

  it('Settings > Security: Change password and the password (and code) forms can be pressed while empty', () => {
    const change = page(createElement(ChangePasswordView, { t, user: USER, onBack: nothing }));
    expect(buttonTag(change, 'Change password')).not.toMatch(/\bdisabled=""/);
    expect(change).not.toContain('role="alert"');
    for (const danger of [false, true]) {
      const form = page(
        createElement(CredentialForm<number>, {
          t,
          id: 'security-off',
          lead: 'Lead',
          submitLabel: 'Turn off',
          withCode: true,
          danger,
          work: () => Promise.resolve(1),
          onResult: nothing
        })
      );
      const button = buttonTag(form, 'Turn off');
      expect(button, `danger ${String(danger)}`).toContain('type="submit"');
      expect(button, `danger ${String(danger)}`).not.toMatch(/\bdisabled=""/);
      expect(form).not.toContain('role="alert"');
    }
  });
});

/** A password check in a given state (null: its data still loading). */
const checkIn = (assessment: PasswordCheck['assessment']): PasswordCheck => ({
  ready: assessment !== null,
  failed: false,
  assessment,
  data: undefined,
  retry: nothing,
  role: 'admin'
});
const EMPTY = checkIn({ ok: false, problems: ['too_short'], bits: 0, level: 0, length: 0, min: 16 });
const passwordField = (value: string, submitted: boolean, check: PasswordCheck): string =>
  renderToStaticMarkup(createElement(PasswordField, { t, id: 'pw', label: 'Password', value, onChange: nothing, check, submitted }));
const statusLine = (html: string): string => /<p id="pw-status"[^>]*>[\s\S]*?<\/p>/.exec(html)?.[0] ?? '';
const passwordInput = (html: string): string => /<input[^>]*id="pw"[^>]*>/.exec(html)?.[0] ?? '';

describe('the step of a flow', () => {
  it('says the step in words beside a bar of one segment per step, the done ones on (the bar is a picture)', () => {
    const html = renderToStaticMarkup(createElement(AuthSteps, { current: 2, total: 3 }));
    expect(html).toContain('Step 2 of 3');
    expect(html.match(/class="au-steps-seg"/g)).toHaveLength(3);
    expect(html.match(/data-on="true"/g)).toHaveLength(2);
    expect(html).toMatch(/<span class="au-steps-bar" aria-hidden="true">/);
  });

  it('Setup shows its first step over the title', () => {
    const html = page(
      createElement(SetupScreen, { t, session: { authenticated: false, setup_required: true, configured: true, missing_secrets: [] } })
    );
    expect(html.indexOf('Step 1 of 2')).toBeGreaterThan(-1);
    expect(html.indexOf('Step 1 of 2')).toBeLessThan(html.indexOf('<h1'));
  });
});

/** A component that fails to render: what the crash screen stands in for. */
const Broken = (): never => {
  throw new Error('broken on purpose');
};

describe('the crash screen', () => {
  it('is a status page: Edgar (112 px), the title as the h1, one line, and Reload as the one primary button', () => {
    // The server renderer does not run error boundaries: render the boundary in its failed state directly.
    const boundary = new ErrorBoundary({ children: createElement(Broken) });
    boundary.state = { failed: true };
    const html = renderToStaticMarkup(boundary.render() as ReactElement);
    expect(html).toContain('class="au-page"');
    expect(html).toMatch(/<img src="\/edgar\.svg" alt="" width="112"/);
    expect(html).toMatch(/<h1 class="ui-empty-title">Something went wrong<\/h1>/);
    expect(html.match(/data-variant="primary"/g)).toHaveLength(1);
    expect(html).toContain('Reload</button>');
  });
});

describe('PasswordField after a press of the form', () => {
  it('says nothing is wrong with an empty field before the press: the rules, in the neutral tone', () => {
    const html = passwordField('', false, EMPTY);
    expect(statusLine(html)).not.toContain('data-tone');
    expect(statusLine(html)).not.toContain('Choose a password.');
    expect(passwordInput(html)).toContain('aria-invalid="false"');
  });

  it('after the press, says in red that a password is needed, then the rules, and marks the field invalid', () => {
    const html = passwordField('', true, EMPTY);
    expect(statusLine(html)).toContain('data-tone="danger"');
    // The check is an admin's (EMPTY: min 16), so the rules are the admin's alone (J4-17).
    expect(statusLine(html)).toMatch(/Choose a password\. At least 16 characters \(admin account\)/);
    expect(passwordInput(html)).toContain('aria-invalid="true"');
    expect(passwordInput(html)).toContain('aria-describedby="pw-status"');
  });

  it('says so even while the check is still loading, and shows the loading line once something is typed', () => {
    expect(statusLine(passwordField('', true, checkIn(null)))).toContain('Choose a password.');
    const typed = statusLine(passwordField('something', true, checkIn(null)));
    expect(typed).not.toContain('Choose a password.');
    expect(typed).toContain('Loading the password check');
  });
});

describe('the sign-in and unlock cards say where and how', () => {
  it('Sign in: a greeting as the h1 (not the button label), a real-looking link to Forgot password with what a reset needs, the trust line', () => {
    const html = page(createElement(SignInScreen, { t, onForgot: nothing }));
    expect(html).toMatch(/<h1[^>]*>Welcome back<\/h1>/);
    expect(html).not.toMatch(/<h1[^>]*>Sign in<\/h1>/);
    expect(buttonTag(html, 'Sign in')).toContain('type="submit"');
    // Forgot password: a ghost button with the link look, described by the line under it (the recovery key).
    const forgot = buttonTag(html, 'Forgot password');
    expect(forgot).toContain('class="ui-btn au-link-btn"');
    expect(forgot).toContain('aria-describedby="signin-forgot-hint"');
    expect(html).toMatch(/<p id="signin-forgot-hint" class="au-link-hint">You need your recovery key to reset it\.<\/p>/);
    // The shared-device row explains itself before it is ticked, in one short line.
    expect(html).toContain('id="signin-shared-hint"');
    expect(html).toContain('Asks for your password again when this tab is closed or reloaded.');
    // The trust line: a lock and one sentence, after the form's actions.
    expect(html).toMatch(/<p class="au-trust"><svg[^>]*aria-hidden="true"[\s\S]*?<\/svg><span>Your mail is stored encrypted/);
    expect(html.indexOf('class="au-trust"')).toBeGreaterThan(html.indexOf('signin-forgot-hint'));
    // The card stands on its stage (the glow centred on it).
    expect(html.indexOf('class="au-stage"')).toBeLessThan(html.indexOf('class="au-card"'));
  });

  it('Unlock: the short shared-device line and the trust line, and the same pieces render alone', () => {
    const html = page(createElement(UnlockScreen, { t, user: { ...USER, has_keys: true } }));
    expect(html).toContain('Asks for your password again when this tab is closed or reloaded.');
    expect(html).toContain('class="au-trust"');
    const link = renderToStaticMarkup(createElement(HintedLink, { id: 'x', label: 'Go', hint: 'Needs a key', onClick: nothing }));
    expect(link).toMatch(/^<div class="au-hinted"><button type="button" class="ui-btn au-link-btn" data-variant="ghost" data-size="sm"/);
    expect(renderToStaticMarkup(createElement(TrustLine))).toMatch(/^<p class="au-trust">/);
  });
});
