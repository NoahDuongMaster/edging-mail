import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { UnlockScreen } from '../../src/client/components/auth/UnlockScreen';
import { sessionKey } from '../../src/client/lib/auth';
import type { Session, SessionUser } from '../../src/client/lib/auth';
import { rememberSharedDevice, setSharedDeviceStorage, sharedDeviceStart } from '../../src/client/lib/crypto/sharedDevice';
import { getTokens } from '../../src/client/theme';

// The unlock screen as the browser first sees it (rendered on the server side of React, no browser): CK-17 puts Sign out first, before the password
// and the language list, because on a shared computer the next person to see this screen is not the owner; C-5 starts the "shared device" box ticked
// when the person signed in that way in this tab.

const USER: SessionUser = {
  id: 'u1',
  email: 'dana@example.com',
  display_name: 'Dana',
  role: 'member',
  must_change_password: false,
  has_keys: true,
  totp_enabled: false,
  require_2fa: false,
  two_factor_reset_due_at: null,
  admin_password_upgrade_required: false,
  step_up_at: 0
};

/** The screen as it renders with a session the server described: `shared` is what GET /api/auth/session says about the cookie. */
const render = (session?: Partial<Session>): string => {
  const client = new QueryClient();
  client.setQueryData<Session>(sessionKey, { authenticated: true, user: USER, gate: null, ...session });
  return renderToStaticMarkup(
    createElement(QueryClientProvider, { client }, createElement(UnlockScreen, { t: getTokens(false), user: USER }))
  );
};

/** The tag of the shared-device checkbox in a page. */
const box = (html: string): string => /<input[^>]*id="unlock-shared"[^>]*>/.exec(html)?.[0] ?? '';

function nothing(): void {
  // A write the test never looks at.
}

/** The storage of a second tab: nothing in it, whatever is written. */
const EMPTY_TAB = { getItem: () => null, setItem: nothing, removeItem: nothing };

afterEach(() => {
  setSharedDeviceStorage(undefined);
});

describe('the unlock screen', () => {
  it('has Sign out as its first action: the first button of the page, before the language list and the password', () => {
    const html = render();
    const signOut = html.indexOf('data-action="unlock-sign-out"');
    expect(signOut).toBeGreaterThan(-1);
    expect(html.indexOf('<button')).toBe(html.lastIndexOf('<button', signOut));
    // The language list is the app's own (ui/Select, a combobox), not the browser's <select>; Sign out comes before it too.
    expect(html).not.toContain('<select');
    const picker = html.indexOf('id="auth-language"');
    expect(picker).toBeGreaterThan(-1);
    expect(html.slice(picker, html.indexOf('>', picker))).toContain('role="combobox"');
    expect(signOut).toBeLessThan(picker);
    expect(signOut).toBeLessThan(html.indexOf('id="unlock-password"'));
    // One Sign out, not a second one under the Unlock button.
    expect(html.split('data-action="unlock-sign-out"')).toHaveLength(2);
  });

  it('keeps the password field, the shared-device box and the Unlock button', () => {
    const html = render();
    expect(html).toContain('id="unlock-password"');
    expect(html).toContain('id="unlock-shared"');
    expect(html).toContain('type="submit"');
  });

  it('starts the shared-device box empty, and ticked after a shared-device sign-in in this tab (C-5)', () => {
    const values = new Map<string, string>();
    setSharedDeviceStorage({
      getItem: (name) => values.get(name) ?? null,
      setItem: (name, value) => values.set(name, value),
      removeItem: (name) => values.delete(name)
    });
    expect(box(render())).toContain('id="unlock-shared"');
    expect(box(render())).not.toMatch(/\bchecked\b/);
    rememberSharedDevice(true);
    expect(box(render())).toMatch(/\bchecked\b/);
    rememberSharedDevice(false);
    expect(box(render())).not.toMatch(/\bchecked\b/);
  });

  it('starts ticked and locked on in a second tab, when the server says this session is a shared-device one (C-5b)', () => {
    // A second tab: no memory of its own (an empty tab storage), the same session cookie.
    setSharedDeviceStorage(EMPTY_TAB);
    const tag = box(render({ shared: true }));
    expect(tag).toMatch(/\bchecked\b/);
    expect(tag).toMatch(/\bdisabled\b/);
  });

  it("leaves the box in the person's hands when the server does not say shared (absent or false)", () => {
    setSharedDeviceStorage(EMPTY_TAB);
    for (const session of [{}, { shared: false }]) {
      const tag = box(render(session));
      expect(tag).not.toMatch(/\bchecked\b/);
      expect(tag).not.toMatch(/\bdisabled\b/);
    }
  });
});

describe('sharedDeviceStart', () => {
  it("the server wins and locks the box; otherwise the tab's own memory decides and nothing is locked", () => {
    const values = new Map<string, string>();
    setSharedDeviceStorage({
      getItem: (name) => values.get(name) ?? null,
      setItem: (name, value) => values.set(name, value),
      removeItem: (name) => values.delete(name)
    });
    expect(sharedDeviceStart()).toEqual({ shared: false, locked: false });
    expect(sharedDeviceStart(false)).toEqual({ shared: false, locked: false });
    expect(sharedDeviceStart(true)).toEqual({ shared: true, locked: true });
    rememberSharedDevice(true);
    expect(sharedDeviceStart(false)).toEqual({ shared: true, locked: false });
    expect(sharedDeviceStart()).toEqual({ shared: true, locked: false });
  });
});
