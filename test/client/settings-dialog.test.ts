import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { SettingsModal } from '../../src/client/components/SettingsModal';
import { DeveloperDocs } from '../../src/client/components/settings/DeveloperDocs';
import { activityKey } from '../../src/client/lib/activity';
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

function render(options: { role?: SessionUser['role']; dark?: boolean } = {}): string {
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
        onOpenAdmin: nothing
      })
    )
  );
}

/** The opening tag of the element with this id. */
const tagOf = (html: string, id: string): string => new RegExp(String.raw`<[a-z0-9]+\b[^>]*\bid="${id}"[^>]*>`).exec(html)?.[0] ?? '';
const tabs = (html: string): string[] => html.match(/<button\b[^>]*role="tab"[^>]*>/g) ?? [];
const radios = (html: string): string[] => html.match(/<input\b[^>]*type="radio"[^>]*>/g) ?? [];

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

  it('shows an admin exactly the four tabs in the toolbar row between the title and the content, Account first and selected, with the ids the panels point to', () => {
    const html = render();
    expect(html).toMatch(
      /<\/h2>[\s\S]*?<div class="ui-dialog-toolbar"><div role="tablist"[^>]*class="ui-tabs st-tabs"[\s\S]*?<div class="ui-dialog-body">/
    );
    const found = tabs(html);
    expect(found.map((tag) => /id="([^"]+)"/.exec(tag)?.[1])).toEqual([
      'settings-tab-account',
      'settings-tab-architecture',
      'settings-tab-deployment',
      'settings-tab-routing'
    ]);
    expect(found[0]).toContain('aria-selected="true"');
    expect(found.slice(1).every((tag) => tag.includes('aria-selected="false"') && tag.includes('tabindex="-1"'))).toBe(true);
    const panel = tagOf(html, 'settings-panel-account');
    expect(panel).toContain('role="tabpanel"');
    expect(panel).toContain('aria-labelledby="settings-tab-account"');
  });

  it('shows a member no tabs: one panel right under the title (settings.css draws the hairline there)', () => {
    const html = render({ role: 'member' });
    expect(tabs(html)).toEqual([]);
    expect(html).not.toContain('role="tablist"');
    expect(html).not.toContain('ui-dialog-toolbar');
    // The head (title and X) is followed by the content at once: `.st-dialog > .ui-dialog-head + .ui-dialog-body` puts the hairline there.
    expect(html).toMatch(
      /<div class="ui-dialog-head"><h2 [^>]*>Settings<\/h2><button\b[^>]*>[\s\S]*?<\/button><\/div><div class="ui-dialog-body">/
    );
    expect(tagOf(html, 'settings-panel-account')).not.toContain('role=');
  });

  it('chooses the theme with two radios (light and dark) that follow the theme on screen, not with a hand-made switch', () => {
    for (const dark of [false, true]) {
      const found = radios(render({ dark }));
      expect(found).toHaveLength(2);
      const checked = found.filter((tag) => tag.includes('checked=""'));
      expect(checked).toHaveLength(1);
      expect(checked[0]).toContain(`value="${dark ? 'dark' : 'light'}"`);
    }
    expect(render()).not.toMatch(/role="switch"[^>]*aria-labelledby="settings-dark-label"/);
  });

  it('lists the sign-ins as a hairline list with a machine date, and the Security rows with their actions', () => {
    const html = render();
    // The list carries the id that its Show all button names (aria-controls); one sign-in needs no such button.
    expect(html).toMatch(/<ul id="account-signins-list" aria-labelledby="account-signins" class="st-list"><li [^>]*class="st-entry">/);
    expect(html).not.toContain('st-more');
    expect(html).toMatch(/<time datetime="2026-11-02T09:30:00\.000Z" class="st-entry-time">/i);
    expect(html).toMatch(/<span class="st-entry-kind" data-ok="false">/);
    for (const id of ['security-password', 'security-key', 'security-two-factor']) {
      expect(tagOf(html, `${id}-label`), id).toContain('class="st-setting-label"');
    }
    expect(tagOf(html, 'security-title')).toMatch(/^<h3 [^>]*tabindex="-1"/i);
  });

  it('uses the ui fields for the profile, with the hint of the read-only address linked to it', () => {
    const html = render();
    expect(tagOf(html, 'settings-name')).toContain('class="ui-input-el"');
    const from = tagOf(html, 'settings-from');
    expect(from).toMatch(/readonly=""/i);
    expect(from).toContain('aria-describedby="settings-from-hint"');
    expect(tagOf(html, 'settings-signature')).toMatch(/^<textarea [^>]*class="ui-input-el"/);
  });

  it('while a secret is held: every tab, both Close buttons, Sign out and the admin console button are disabled (C-7)', () => {
    released.push(holdSecret());
    const html = render();
    expect(tabs(html).every((tag) => tag.includes('disabled=""'))).toBe(true);
    const shut = (html.match(/<button\b[^>]*>/g) ?? []).filter((tag) => tag.includes('disabled=""'));
    // Four tabs, the X, Sign out, the admin console and the footer Close (Save is disabled too: the form is untouched).
    expect(shut.length).toBeGreaterThanOrEqual(8);
    expect(tagOf(html, 'settings-tab-account')).toContain('disabled=""');
  });
});

/** One technical tab on its own (DeveloperDocs needs no query). */
const docs = (tab: 'architecture' | 'deployment' | 'routing'): string =>
  renderToStaticMarkup(createElement(DeveloperDocs, { t: getTokens(false), tab }));

describe('the technical tabs', () => {
  it('list the parts of the deployment as a hairline description list, no cards and no coloured icons', () => {
    const html = docs('architecture');
    expect(html).toMatch(/^<dl class="st-defs">/);
    expect(html.match(/<div class="st-def">/g)).toHaveLength(9);
    expect(html).not.toMatch(/color="#|style="/);
  });

  it('keep the five deployment steps with their commands, and both halves of the mail setup with the Email Sending onboarding', () => {
    const deployment = docs('deployment');
    // ui Steps (numbered in the circles, so the titles carry no number of their own) and ui CodeBlocks for the commands.
    expect(deployment.match(/<h3 class="ui-step-title">/g)).toHaveLength(5);
    expect(deployment).not.toMatch(/<h3 class="ui-step-title">\d/);
    expect(deployment.match(/<pre translate="no" class="ui-code">/g)).toHaveLength(4);
    expect(deployment).toContain('npm run db:migrate:remote');
    const routing = docs('routing');
    expect(routing.match(/<h3 class="st-docs-title">/g)).toHaveLength(2);
    expect(routing.match(/<ol role="list" class="ui-steps">/g)).toHaveLength(2);
    expect(routing).toContain('Email Sending');
    expect(routing).toContain('E_RECIPIENT_NOT_ALLOWED');
  });
});
