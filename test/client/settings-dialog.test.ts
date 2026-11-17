import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { SettingsModal, type SettingsSection } from '../../src/client/components/SettingsModal';
import { DeveloperDocs } from '../../src/client/components/settings/DeveloperDocs';
import { activityKey } from '../../src/client/lib/activity';
import { tr } from '../../src/client/lib/i18n';
import { sessionKey } from '../../src/client/lib/auth';
import type { Session, SessionUser } from '../../src/client/lib/auth';
import { holdSecret } from '../../src/client/lib/secretHold';
import { settingsKey } from '../../src/client/lib/settings';
import { getTokens } from '../../src/client/theme';

// The Settings dialog as the browser first sees it (rendered on the server side of React, no browser): the ui dialog shell with its tabs, the
// Account sections and their controls, and what a held secret (C-7) disables. Open popups, focus and the phone grid of tabs need a real browser.

const USER: SessionUser = {
  id: 'u1',
  email: 'dana@example.com',
  display_name: 'Dana',
  role: 'admin',
  must_change_password: false,
  has_keys: true,
  totp_enabled: true,
  require_2fa: false,
  two_factor_reset_due_at: null,
  admin_password_upgrade_required: false,
  step_up_at: 0
};

const released: (() => void)[] = [];
afterEach(() => {
  for (const release of released.splice(0)) {
    release();
  }
});

function nothing(): void {
  // A handler the test never calls.
}

function render(options: { role?: SessionUser['role']; dark?: boolean; section?: SettingsSection } = {}): string {
  const client = new QueryClient();
  const user: SessionUser = { ...USER, role: options.role ?? 'admin' };
  client.setQueryData<Session>(sessionKey, { authenticated: true, user, gate: null });
  client.setQueryData(settingsKey, { display_name: 'Dana', signature: 'Dana', email: user.email });
  client.setQueryData(activityKey, {
    activity: [{ at: Date.UTC(2026, 10, 2, 9, 30), ip: '192.0.2.1', user_agent: null, ok: false, kind: 'sign_in' }],
    notices: []
  });
  return renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client },
      createElement(SettingsModal, {
        isOpen: true,
        t: getTokens(options.dark ?? false),
        onClose: nothing,
        onToggleDark: nothing,
        onOpenAdmin: nothing,
        initialSection: options.section
      })
    )
  );
}

/** The opening tag of the element with this id. */
const tagOf = (html: string, id: string): string => new RegExp(String.raw`<[a-z0-9]+\b[^>]*\bid="${id}"[^>]*>`).exec(html)?.[0] ?? '';
const tabs = (html: string): string[] => html.match(/<button\b[^>]*role="tab"[^>]*>/g) ?? [];
const radios = (html: string): string[] => html.match(/<input\b[^>]*type="radio"[^>]*>/g) ?? [];
const ACCOUNT_IDS = ['profile', 'appearance', 'mail', 'language', 'notifications', 'keyboard', 'security'].map(
  (id) => `settings-tab-${id}`
);
const DOCS_IDS = ['architecture', 'deployment', 'routing'].map((id) => `settings-tab-${id}`);

describe('the Settings dialog', () => {
  it('is the large ui dialog drawn in place: the scrim keeps its place under the toast, the panel is the dialog, lg, named by its title', () => {
    const html = render();
    // Rendered on the server at all: the inline ui Dialog has no portal and does not touch `document` while it renders.
    expect(html).toMatch(/^<div role="presentation" class="ui-dialog-root st-root">/);
    const panel = /<div\b[^>]*role="dialog"[^>]*>/.exec(html)?.[0] ?? '';
    expect(panel).toContain('aria-modal="true"');
    expect(panel).toContain('tabindex="-1"');
    expect(panel).toContain('class="ui-dialog st-dialog" data-size="lg"');
    const titleId = /aria-labelledby="([^"]+)"/.exec(panel)?.[1] ?? '';
    expect(titleId).not.toBe('');
    expect(html).toContain(`<h2 id="${titleId}" class="ui-dialog-title">Settings</h2>`);
  });

  it('shows an admin the ten sections as one vertical tab list in the nav (the toolbar slot), Profile first and selected, then the admin console as a button, not a tab', () => {
    const html = render();
    // The nav sits between the title and the content: the glide capsule of the open row (decorative), who is signed in, the tab list (Up
    // and Down move), then its foot.
    expect(html).toMatch(
      /<\/h2>[\s\S]*?<div class="ui-dialog-toolbar"><div class="st-nav ui-glide-host" data-pane="nav"><div class="ui-glide st-glide" aria-hidden="true"><\/div><div class="st-identity">[\s\S]*?<div role="tablist" aria-label="Settings sections" aria-orientation="vertical" class="ui-tabs st-tabs">[\s\S]*?<div class="ui-dialog-body">/
    );
    const found = tabs(html);
    expect(found.map((tag) => /id="([^"]+)"/.exec(tag)?.[1])).toEqual([...ACCOUNT_IDS, ...DOCS_IDS]);
    expect(found[0]).toContain('aria-selected="true"');
    expect(found.slice(1).every((tag) => tag.includes('aria-selected="false"') && tag.includes('tabindex="-1"'))).toBe(true);
    // The two groups (the account, the technical sections) have a visual label only (a tab list holds tabs): read out, each tab's own name
    // stands alone.
    expect(html).toContain('<span class="ui-tab-group" aria-hidden="true">Account</span>');
    expect(html).toContain('<span class="ui-tab-group" aria-hidden="true">Technical</span>');
    const panel = tagOf(html, 'settings-panel-profile');
    expect(panel).toContain('role="tabpanel"');
    expect(panel).toContain('aria-labelledby="settings-tab-profile"');
    // The admin console and Sign out are buttons at the foot of the nav, after the list.
    const foot = /<div class="st-nav-foot">[\s\S]*?<\/div><\/div><\/div>/.exec(html)?.[0] ?? '';
    expect(foot).toContain('Admin console');
    expect(foot).toContain('Sign out');
    expect(foot).not.toContain('role="tab"');
    // Each section is a page: its title (h3, can take the focus on a phone) and one line under it.
    expect(html).toMatch(/<h3 id="[^"]+" tabindex="-1" class="st-page-title st-focus-title">Profile<\/h3><p class="st-page-desc">/);
  });

  it('shows a member the seven sections of the account: no technical sections and no admin console', () => {
    const html = render({ role: 'member' });
    expect(tabs(html).map((tag) => /id="([^"]+)"/.exec(tag)?.[1])).toEqual(ACCOUNT_IDS);
    expect(html).not.toContain('ui-tab-group');
    expect(html).not.toContain('Admin console');
    expect(html).toContain('Sign out');
    expect(tagOf(html, 'settings-panel-profile')).toContain('role="tabpanel"');
  });

  it('on a phone, a section has a way back to the list (hidden on a desktop by settings.css)', () => {
    const html = render({ section: 'keyboard' });
    expect(html).toMatch(/<div class="st-back"><button\b[^>]*>[\s\S]*?Settings<\/button><\/div>/);
    expect(tagOf(html, 'settings-tab-keyboard')).toContain('aria-selected="true"');
  });

  it('chooses the theme with two radios (light and dark) that follow the theme on screen, not with a hand-made switch', () => {
    for (const dark of [false, true]) {
      const found = radios(render({ dark, section: 'appearance' })).filter((tag) => /value="(light|dark)"/.test(tag));
      expect(found).toHaveLength(2);
      const checked = found.filter((tag) => tag.includes('checked=""'));
      expect(checked).toHaveLength(1);
      expect(checked[0]).toContain(`value="${dark ? 'dark' : 'light'}"`);
    }
    expect(render({ section: 'appearance' })).not.toMatch(/role="switch"[^>]*aria-labelledby="settings-dark-label"/);
  });

  it('offers Light, Dark and Match system when the stored theme choice is given (J6-16), the chosen one checked', () => {
    const html = renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client: new QueryClient() },
        createElement(SettingsModal, {
          isOpen: true,
          t: getTokens(false),
          onClose: nothing,
          onToggleDark: nothing,
          themeChoice: 'system',
          onThemeChoice: nothing,
          onOpenAdmin: nothing,
          initialSection: 'appearance'
        })
      )
    );
    // The theme's own group (Motion has a 'system' radio too).
    const theme = /<fieldset class="ui-radio-group st-theme st-theme-3">[\s\S]*?<\/fieldset>/.exec(html)?.[0] ?? '';
    const found = radios(theme);
    expect(found.map((tag) => /value="(\w+)"/.exec(tag)?.[1])).toEqual(['light', 'dark', 'system']);
    expect(found.filter((tag) => tag.includes('checked=""'))).toEqual([expect.stringContaining('value="system"')]);
    expect(html).toContain('Match system');
  });

  it('puts the row density and the undo-send time in the Mail section (device preferences, lib/prefs.ts)', () => {
    const mail = render({ section: 'mail' });
    expect(radios(mail).filter((tag) => /value="(comfortable|compact)"/.test(tag))).toHaveLength(2);
    expect(tagOf(mail, 'prefs-undo-send')).toMatch(/role="combobox"/);
    expect(mail).toContain('10 seconds');
  });

  it('keeps Save enabled on an untouched profile (a press says there is nothing to save) and names the admin console with a chevron', () => {
    const html = render();
    const save = /<button\b[^>]*type="submit"[^>]*>/.exec(html)?.[0] ?? '';
    expect(save).not.toContain('disabled');
    expect(html).not.toContain('lucide-arrow-up-right');
    expect(html).toContain('lucide-chevron-right');
  });

  it('places the device preferences: Motion under Appearance, the single-key shortcuts switch and the keys under Keyboard (no table Tab stop)', () => {
    const appearance = render({ section: 'appearance' });
    expect(radios(appearance).filter((tag) => /value="(system|reduce)"/.test(tag))).toHaveLength(2);
    const keyboard = render({ section: 'keyboard' });
    expect(tagOf(keyboard, 'prefs-shortcuts')).toMatch(/role="switch"/);
    // Every key, from the one list the ? dialog draws too (J4-29, J6-28: components/ShortcutList), and the way to that dialog.
    expect(keyboard).toMatch(/<h5 id="prefs-keys-move" class="sk-title">/);
    expect(keyboard).toContain(`<dd>${tr('shortcuts.select_down')}</dd>`);
    expect(keyboard).toContain(tr('shortcuts.anywhere'));
    expect(keyboard).toMatch(new RegExp(`<button[^>]*>${tr('shortcuts.open')}</button>`));
    expect(keyboard).not.toContain('ui-table-wrap');
  });

  it('shows Security as status cards with one action each, and the latest sign-in on the activity card', () => {
    const html = render({ section: 'security' });
    for (const id of [
      'security-two-factor',
      'security-key',
      'security-codes',
      'security-password',
      'security-devices',
      'security-activity'
    ]) {
      expect(tagOf(html, `${id}-label`), id).toMatch(/^<h4 [^>]*class="st-status-title"/);
    }
    expect(tagOf(html, 'security-title')).toMatch(/^<h3 [^>]*tabindex="-1"/i);
    // An admin cannot turn two-factor sign-in off: the card says why and offers no Turn off.
    expect(html).toContain('Admin accounts always need two-factor sign-in');
    expect(html).not.toContain('data-view="two_factor_off"');
    expect(html).toMatch(/<button\b[^>]*data-view="activity"[^>]*>Review<\/button>/);
    // Signing out the other devices is one more card with one action (its form asks for the password).
    expect(html).toMatch(/<button\b[^>]*data-view="devices"[^>]*>Sign out other devices<\/button>/);
    expect(html).toContain('Sign-in failed · ');
  });

  it('uses the ui fields for the profile, with the hint of the read-only address linked to it', () => {
    const html = render();
    expect(tagOf(html, 'settings-name')).toContain('class="ui-input-el"');
    const from = tagOf(html, 'settings-from');
    expect(from).toMatch(/readonly=""/i);
    expect(from).toContain('aria-describedby="settings-from-hint"');
    expect(tagOf(html, 'settings-signature')).toMatch(/^<textarea [^>]*class="ui-input-el"/);
  });

  it('while a secret is held: every tab, the X, Sign out, the phone Back and the admin console button are disabled (C-7)', () => {
    released.push(holdSecret());
    const html = render();
    expect(tabs(html).every((tag) => tag.includes('disabled=""'))).toBe(true);
    const shut = (html.match(/<button\b[^>]*>/g) ?? []).filter((tag) => tag.includes('disabled=""'));
    // Ten tabs, the X, the phone Back, Sign out and the admin console (Save stays enabled: a press with nothing changed says so). There is
    // no footer Close: the X, Escape, the scrim and a phone's Back button are the ways out, each through the guarded `leave`.
    expect(shut.length).toBeGreaterThanOrEqual(14);
    expect(tagOf(html, 'settings-tab-profile')).toContain('disabled=""');
  });
});

/** One technical tab on its own (DeveloperDocs needs no query). */
const docs = (tab: 'architecture' | 'deployment' | 'routing'): string =>
  renderToStaticMarkup(createElement(DeveloperDocs, { t: getTokens(false), tab }));

describe('the technical tabs', () => {
  it('list the parts of the deployment as one grouped card of rows (a description list), no inline colours', () => {
    const html = docs('architecture');
    expect(html).toMatch(/^<dl class="st-defs">/);
    expect(html.match(/<div class="st-def">/g)).toHaveLength(9);
    expect(html).not.toMatch(/color="#|style="/);
  });

  it('keep the five deployment steps with their commands (each with a Copy button), and both halves of the mail setup with the Email Sending onboarding', () => {
    const deployment = docs('deployment');
    // ui Steps (numbered in the circles, so the titles carry no number of their own; h4 under the page's h3) and ui CodeBlocks for the commands.
    expect(deployment.match(/<h4 class="ui-step-title">/g)).toHaveLength(5);
    expect(deployment).not.toMatch(/<h4 class="ui-step-title">\d/);
    expect(deployment.match(/<pre translate="no" class="ui-code">/g)).toHaveLength(4);
    expect(deployment.match(/<div class="st-command"><pre\b[\s\S]*?<\/pre><button\b/g)).toHaveLength(4);
    expect(deployment).toContain('npm run db:migrate:remote');
    const routing = docs('routing');
    expect(routing.match(/<h4 id="docs-(receiving|sending)" class="st-docs-title">/g)).toHaveLength(2);
    expect(routing.match(/<ol role="list" class="ui-steps">/g)).toHaveLength(2);
    expect(routing).toContain('Email Sending');
    expect(routing).toContain('E_RECIPIENT_NOT_ALLOWED');
  });
});
