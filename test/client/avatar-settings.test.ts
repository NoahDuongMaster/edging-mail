import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProfilePicture } from '../../src/client/components/settings/ProfilePicture';
import { SettingsModal } from '../../src/client/components/SettingsModal';
import { ApiError } from '../../src/client/lib/api';
import { sessionKey, type Session, type SessionUser } from '../../src/client/lib/auth';
import { deleteAvatar, keepAvatar, putAvatar } from '../../src/client/lib/avatar';
import { tr } from '../../src/client/lib/i18n';
import { settingsKey } from '../../src/client/lib/settings';
import { getTokens } from '../../src/client/theme';

// Profile pictures in Settings > Profile (the row in its states, as markup) and the two requests with the session that follows their answer.

const ID = '0b9a3d2e-5c61-4f0e-9d73-2c1f6a8e7b45';
const URL_OF = `/api/avatars/${ID}`;
const noop = (): void => undefined;

afterEach(() => {
  vi.unstubAllGlobals();
});

/** The <img> of a picture, whole, or '' when there is none. */
const imgOf = (html: string): string => /<img\b[^>]*>/.exec(html)?.[0] ?? '';

const renderWithClient = (client: QueryClient, node: ReturnType<typeof h>): string =>
  renderToStaticMarkup(h(QueryClientProvider, { client }, node));

const answer = (status: number, body: unknown): Response => Response.json(body, { status });

describe('Settings > Profile > the picture', () => {
  it('without a picture: the initials at 56 px, "Add picture", no Remove, the one help line, a hidden file field for images', () => {
    const html = renderWithClient(new QueryClient(), h(ProfilePicture, { name: 'Dana', picture: undefined }));
    expect(html).toContain('data-size="xl"');
    expect(html).toContain('data-selected="true"');
    expect(html).toContain('>D</span>');
    expect(html).not.toContain('<img class="ui-avatar-img"');
    expect(html).toContain(tr('settings.picture'));
    expect(html).toContain(tr('settings.picture_help'));
    expect(html).toContain(`>${tr('settings.picture_add')}</button>`);
    expect(html).not.toContain(tr('settings.picture_change'));
    expect(html).not.toContain(`>${tr('common.remove')}</button>`);
    expect(html).toMatch(/<input type="file" accept="image\/\*" hidden=""/);
    expect(html).not.toContain('role="status"');
    expect(html).not.toContain('role="alert"');
  });

  it('with a picture: it fills the face, the button says "Change picture" and Remove appears, in a group named by the row\'s label', () => {
    const html = renderWithClient(new QueryClient(), h(ProfilePicture, { name: 'Dana', picture: URL_OF }));
    expect(imgOf(html)).toContain(`src="${URL_OF}"`);
    expect(html).toContain(`>${tr('settings.picture_change')}</button>`);
    expect(html).toContain(`>${tr('common.remove')}</button>`);
    expect(html).not.toContain(tr('settings.picture_add'));
    const group = /<div class="st-row-control" role="group" aria-labelledby="([^"]+)"/.exec(html);
    expect(group).not.toBeNull();
    expect(html).toContain(`id="${group?.[1] ?? ''}" class="st-row-label">${tr('settings.picture')}</span>`);
    // No button is disabled or busy at rest.
    expect(html).not.toContain('aria-busy');
    expect(html).not.toContain('aria-disabled');
  });

  it("is the first group of the Profile page, and the nav's own avatar shows the picture too", () => {
    const user: SessionUser = {
      id: 'u1',
      email: 'dana@example.com',
      display_name: 'Dana',
      avatar: ID,
      role: 'member',
      must_change_password: false,
      has_keys: true,
      totp_enabled: true,
      require_2fa: false,
      two_factor_reset_due_at: null,
      admin_password_upgrade_required: false,
      step_up_at: 0
    };
    const client = new QueryClient();
    client.setQueryData<Session>(sessionKey, { authenticated: true, user, gate: null });
    client.setQueryData(settingsKey, { display_name: 'Dana', signature: '', email: user.email });
    const html = renderWithClient(
      client,
      h(SettingsModal, { isOpen: true, t: getTokens(false), onClose: noop, onToggleDark: noop, onOpenAdmin: noop })
    );
    expect(html.match(new RegExp(`<img class="ui-avatar-img" src="${URL_OF}"`, 'g'))).toHaveLength(2);
    expect(html.indexOf('st-picture')).toBeLessThan(html.indexOf('id="settings-name"'));
    expect(html).toContain(tr('settings.picture_change'));
  });
});

describe('the requests and the session', () => {
  it('PUT /api/avatar sends the mime and the base64 as JSON and resolves with the new id', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(answer(200, { success: true, avatar: ID })));
    vi.stubGlobal('fetch', fetchMock);
    await expect(putAvatar({ mime: 'image/webp', data: 'AAEC' })).resolves.toBe(ID);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/avatar');
    expect(init.method).toBe('PUT');
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(JSON.parse(init.body as string)).toEqual({ mime: 'image/webp', data: 'AAEC' });
  });

  it('DELETE /api/avatar resolves with null', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(answer(200, { success: true, avatar: null })));
    vi.stubGlobal('fetch', fetchMock);
    await expect(deleteAvatar()).resolves.toBeNull();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/avatar');
    expect(init.method).toBe('DELETE');
  });

  it('turns `invalid_avatar` into its own translated words, an uncoded failure into the fallback, and leaves the offline TypeError alone', async () => {
    vi.stubGlobal('fetch', () =>
      Promise.resolve(
        answer(400, { success: false, error: 'The picture must be a JPEG or WebP image of at most 12000 bytes', code: 'invalid_avatar' })
      )
    );
    const refused = await putAvatar({ mime: 'image/jpeg', data: 'AAEC' }).catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(ApiError);
    expect((refused as ApiError).code).toBe('invalid_avatar');
    expect((refused as ApiError).message).toBe(tr('err.invalid_avatar'));

    vi.stubGlobal('fetch', () => Promise.resolve(new Response('<html>Bad gateway</html>', { status: 502 })));
    const proxy = await putAvatar({ mime: 'image/jpeg', data: 'AAEC' }).catch((error: unknown) => error);
    expect((proxy as ApiError).message).toBe(tr('fail.avatar_save'));
    const removal = await deleteAvatar().catch((error: unknown) => error);
    expect((removal as ApiError).message).toBe(tr('fail.avatar_remove'));

    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('Failed to fetch')));
    await expect(putAvatar({ mime: 'image/jpeg', data: 'AAEC' })).rejects.toBeInstanceOf(TypeError);
  });

  it('keeps the cached session user in step with the answer (set, replaced, removed), and does nothing when nobody is signed in', () => {
    const client = new QueryClient();
    const user = { id: 'u1', email: 'dana@example.com', display_name: 'Dana', avatar: null } as SessionUser;
    client.setQueryData<Session>(sessionKey, { authenticated: true, user, gate: null });
    keepAvatar(client, ID);
    expect(client.getQueryData<Session>(sessionKey)?.user?.avatar).toBe(ID);
    expect(client.getQueryData<Session>(sessionKey)?.user?.display_name).toBe('Dana');
    keepAvatar(client, null);
    expect(client.getQueryData<Session>(sessionKey)?.user?.avatar).toBeNull();
    const signedOut = new QueryClient();
    signedOut.setQueryData<Session>(sessionKey, { authenticated: false });
    keepAvatar(signedOut, ID);
    expect(signedOut.getQueryData<Session>(sessionKey)).toEqual({ authenticated: false });
    keepAvatar(new QueryClient(), ID);
  });
});
