import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LanguagePanel } from '../../src/client/components/admin/LanguagePanel';
import { OutsidePictures } from '../../src/client/components/admin/OutsidePictures';
import { StepUpProvider } from '../../src/client/components/admin/StepUp';
import { adminErrorText } from '../../src/client/lib/admin/types';
import { ApiError } from '../../src/client/lib/api';
import { tr } from '../../src/client/lib/i18n';
import { orgSettingsKey, putOutsidePictures, type OrgSettings } from '../../src/client/lib/language';
import { getTokens } from '../../src/client/theme';
import en from '../../src/shared/i18n/locales/en.json';
import viJson from '../../src/shared/i18n/locales/vi.json';
import zhCN from '../../src/shared/i18n/locales/zh-CN.json';

// Admin console > Settings > the switch for the pictures of outside senders: its card in the states the server can answer, the words that say
// what it costs, and the one request it makes. The press itself (the optimistic wait, the announcement) needs a browser.

afterEach(() => {
  vi.unstubAllGlobals();
});

const SWITCH_ID = 'admin-outside-pictures';
const TIP_KEYS = [
  'admin.pictures_tip_sent',
  'admin.pictures_tip_kept',
  'admin.pictures_tip_unverified',
  'admin.pictures_tip_later'
] as const;
const settingsOf = (outside_pictures: boolean): OrgSettings => ({
  success: true,
  settings: { default_language: 'en', require_2fa: false, outside_pictures }
});

const withClient = (client: QueryClient, node: ReturnType<typeof h>): string =>
  renderToStaticMarkup(h(QueryClientProvider, { client }, node));

/** The card alone, with what the server said about the setting (`undefined`: not loaded yet). */
const card = (enabled?: boolean): string => withClient(new QueryClient(), h(OutsidePictures, { enabled }));

/** The whole Settings page of the console, as it is with the settings already read. */
const page = (outside_pictures: boolean): string => {
  const client = new QueryClient();
  client.setQueryData(orgSettingsKey, settingsOf(outside_pictures));
  return withClient(client, h(StepUpProvider, { t: getTokens(false), children: h(LanguagePanel, { t: getTokens(false) }) }));
};

/** A text as the markup writes it (the apostrophe is an entity). */
const escaped = (text: string): string => text.replaceAll("'", '&#x27;');

/** The opening tag of the switch. */
const switchTag = (html: string): string => new RegExp(String.raw`<button\b[^>]*\bid="${SWITCH_ID}"[^>]*>`).exec(html)?.[0] ?? '';

describe('the card of the pictures of outside senders', () => {
  it('has its title, the one plain sentence about what it does, an InfoTip about the title and one switch named by its own label', () => {
    const html = card(false);
    expect(html).toContain(tr('admin.pictures_title'));
    expect(html).toContain(`<p class="ui-section-description">${escaped(tr('admin.pictures_desc'))}</p>`);
    expect(html).toContain(`aria-label="${tr('ui.info_about', { label: tr('admin.pictures_title') })}"`);
    expect(html).toContain(`<label for="${SWITCH_ID}" class="ui-label">${tr('admin.pictures_switch')}</label>`);
    expect(html.match(/role="switch"/g)).toHaveLength(1);
    // Nothing else: no question, no field, no button, no status before anything was saved.
    expect(html).not.toMatch(/<form|<input|<textarea/);
    expect(html.match(/<button\b/g)).toHaveLength(2);
    expect(html).not.toContain('role="alert"');
    expect(html).not.toContain('adm-feedback');
  });

  it('is off when the server says off, on when it says on, and cannot be pressed before the settings are read', () => {
    expect(switchTag(card(false))).toContain('aria-checked="false"');
    expect(switchTag(card(false))).not.toContain('disabled');
    expect(switchTag(card(true))).toContain('aria-checked="true"');
    expect(switchTag(card(true))).not.toContain('disabled');
    expect(switchTag(card())).toContain('aria-checked="false"');
    expect(switchTag(card())).toContain('disabled=""');
  });

  it('is the third card of the settings page, after the language and the two-factor rule, and follows the settings the page has read', () => {
    const off = page(false);
    const titles = [tr('lang.label'), tr('admin.policy_title'), tr('admin.pictures_title')].map((title) => off.indexOf(`>${title}</h3>`));
    expect(titles.every((at) => at > -1)).toBe(true);
    expect(titles).toEqual(titles.toSorted((a, b) => a - b));
    expect(switchTag(off)).toContain('aria-checked="false"');
    expect(switchTag(page(true))).toContain('aria-checked="true"');
    // The two-factor switch is a different one: the page has two switches, each with its own state.
    expect(page(true).match(/role="switch"/g)).toHaveLength(2);
  });
});

describe('what the card says', () => {
  it('names both services and the hash in the sentence, says the browsers never contact them, and does not claim to be on', () => {
    const text = tr('admin.pictures_desc');
    expect(text).toMatch(/Gravatar and Libravatar/);
    expect(text).toMatch(/\bhash\b/);
    expect(text).toMatch(/browsers never contact them/);
    expect(text).not.toMatch(/\boff by default\b/i);
  });

  it('keeps the details in its InfoTip: what is sent, by whom and for which senders, what is kept for how long, how far a picture can be trusted', () => {
    expect(tr('admin.pictures_tip_sent')).toMatch(
      /Only a hash of the sender's address is sent, by this server, and only for senders outside its own domains\. Nothing is sent while this is off/
    );
    expect(tr('admin.pictures_tip_kept')).toMatch(/or a note that there is none, is kept for up to 90 days\. Turning this off deletes it/);
    expect(tr('admin.pictures_tip_unverified')).toMatch(/as unverified as its From address/);
    expect(tr('admin.pictures_tip_later')).toMatch(/initials at first.*later refresh/);
  });

  it('says the same facts in Vietnamese and Chinese: both services named, the 90 days, nothing sent while off', () => {
    for (const catalogue of [viJson, zhCN]) {
      expect(catalogue['admin.pictures_desc']).toContain('Gravatar');
      expect(catalogue['admin.pictures_desc']).toContain('Libravatar');
      expect(catalogue['admin.pictures_tip_kept']).toContain('90');
      for (const key of TIP_KEYS) {
        expect(catalogue[key], key).toBeTruthy();
      }
    }
    expect(en['admin.pictures_tip_kept']).toContain('90');
  });

  // The bubble of an InfoTip is words only: ui.css gives it `max-height: 320px` and `overflow: visible`, so a tip that is too long does not scroll,
  // its last lines are drawn outside the box (found in the lab with five paragraphs). Measured there at 300px wide: about 38 Latin letters or
  // 17 Chinese characters to a line, 22px a line on a phone (20px on a desktop), 8px between two paragraphs, 10px of padding above and below
  // (the lab's 308px for Vietnamese on a phone is this estimate to the pixel).
  it.each([
    ['en', en, 38],
    ['vi', viJson, 38],
    ['zh-CN', zhCN, 17]
  ] as const)('has a tip that fits its bubble in %s (320px high, no scrolling)', (_language, catalogue, perLine) => {
    const lines = TIP_KEYS.map((key) => Math.ceil(catalogue[key].length / perLine));
    const height = 20 + lines.reduce((sum, count) => sum + count * 22, 0) + (lines.length - 1) * 8;
    expect(height).toBeLessThanOrEqual(320);
  });
});

const answer = (status: number, body: unknown): Response => Response.json(body, { status });
const sent = (fetchMock: ReturnType<typeof vi.fn>): { url: string; init: RequestInit; body: unknown } => {
  const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  return { url, init, body: JSON.parse(init.body as string) as unknown };
};

describe('saving', () => {
  it.each([true, false])('sends exactly { outside_pictures: %s } with PUT to /api/admin/settings, and nothing else', async (value) => {
    const fetchMock = vi.fn(() => Promise.resolve(answer(200, { success: true })));
    vi.stubGlobal('fetch', fetchMock);
    await putOutsidePictures(value);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = sent(fetchMock);
    expect(request.url).toBe('/api/admin/settings');
    expect(request.init.method).toBe('PUT');
    expect(request.init.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(request.body).toEqual({ outside_pictures: value });
    expect(Object.keys(request.body as object)).toEqual(['outside_pictures']);
  });

  it('turns a refusal into words in the UI language, and an offline fetch into "No connection" (never the browser\'s own text)', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(answer(400, { success: false, error: 'bad', code: 'invalid_request' })));
    const refused = await putOutsidePictures(true).catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(ApiError);
    expect(adminErrorText(refused)).toBe(tr('err.invalid_request'));

    // A proxy page with no JSON and no code: the caller's own words.
    vi.stubGlobal('fetch', () => Promise.resolve(new Response('<html></html>', { status: 502 })));
    expect(adminErrorText(await putOutsidePictures(false).catch((error: unknown) => error))).toBe(tr('fail.outside_pictures_save'));

    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('Failed to fetch')));
    expect(adminErrorText(await putOutsidePictures(true).catch((error: unknown) => error))).toBe(tr('app.no_connection'));
  });
});
