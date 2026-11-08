import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { AccountActivity } from '../../src/client/components/AccountActivity';
import { activityKey, type SignIn } from '../../src/client/lib/activity';
import { setLocale } from '../../src/shared/i18n';
import { getTokens } from '../../src/client/theme';

// Settings > Account > Recent sign-ins as the browser first sees it (React's server render, no browser): the three latest rows, and under them
// one quiet button that shows the rest of the list (aria-expanded, aria-controls naming the list) only when there is a rest. Clicking it, the
// focus that stays on it and the list growing need a real browser.

afterEach(async () => {
  await setLocale('en');
});

/** `count` sign-ins, newest first, each one a minute older than the one before. */
const signIns = (count: number): SignIn[] =>
  Array.from({ length: count }, (_, index) => ({
    at: Date.UTC(2026, 10, 2, 9, 30) - index * 60_000,
    ip: `192.0.2.${index + 1}`,
    user_agent: null,
    ok: index % 4 !== 3,
    kind: 'sign_in'
  }));

function render(count: number): string {
  const client = new QueryClient();
  client.setQueryData(activityKey, { activity: signIns(count), notices: [] });
  return renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(AccountActivity, { t: getTokens(false) })));
}

const rows = (html: string): string[] => html.match(/<li [^>]*class="st-entry">/g) ?? [];
const toggles = (html: string): string[] => html.match(/<button\b[^>]*aria-controls="account-signins-list"[^>]*>[\s\S]*?<\/button>/g) ?? [];

describe('the recent sign-ins', () => {
  it('show the three latest rows, then a Show all button with the whole count that controls the list and says it is closed', () => {
    for (const count of [4, 12, 50]) {
      const html = render(count);
      expect(rows(html), `${count} sign-ins`).toHaveLength(3);
      // The newest three, in order: the fourth one (192.0.2.4) is not in the page until Show all.
      expect(html).toContain('192.0.2.3');
      expect(html).not.toContain('192.0.2.4');
      const found = toggles(html);
      expect(found, `${count} sign-ins`).toHaveLength(1);
      const button = found[0] ?? '';
      expect(button).toMatch(/^<button type="button" class="ui-btn ui-disclosure st-more" data-variant="ghost" data-size="sm"/);
      expect(button).toContain('aria-expanded="false"');
      expect(button).toContain(`Show all (${count})`);
      // The button sits right under the list it controls, and that list carries the id it names.
      expect(html).toMatch(
        /<ul id="account-signins-list" aria-labelledby="account-signins" class="st-list">[\s\S]*?<\/ul><button\b[^>]*st-more/
      );
    }
  });

  it('have no button when there are three rows or fewer: every row is already shown', () => {
    for (const count of [1, 2, 3]) {
      const html = render(count);
      expect(rows(html), `${count} sign-ins`).toHaveLength(count);
      expect(toggles(html), `${count} sign-ins`).toEqual([]);
      expect(html).not.toContain('st-more');
      expect(html).not.toContain('Show all');
    }
    const empty = render(0);
    expect(empty).toContain('No sign-ins recorded yet.');
    expect(empty).not.toContain('st-more');
  });

  it('write the count with the language of the page', async () => {
    await setLocale('vi');
    expect(toggles(render(7))[0]).toContain('Hiện tất cả (7)');
    await setLocale('zh-CN');
    expect(toggles(render(1234))[0]).toContain('显示全部（1,234）');
  });
});
