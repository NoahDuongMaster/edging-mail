import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, UnauthorizedError, apiGet, apiPost } from '../../src/client/lib/api';

// Which answers end the session (sign out, wipe the key) and which are only a wrong credential on a route that needs one (CK-13, Phase 2b).

function answer(status: number, body: unknown, headers: Record<string, string> = {}): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(Response.json(body, { status, headers })))
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('a 401 and what it means', () => {
  it('ends the session when an authenticated route says unauthorized', async () => {
    answer(401, { success: false, code: 'unauthorized' });
    await expect(apiGet('/api/messages', 'common.something_wrong')).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('ends the session when a 401 carries no code at all (a proxy page)', async () => {
    answer(401, null);
    await expect(apiGet('/api/messages', 'common.something_wrong')).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('does not end the session for a wrong authenticator code on an authenticated route', async () => {
    answer(401, { success: false, code: 'wrong_code' });
    const failure = await apiPost('/api/auth/2fa/disable', {}, 'common.something_wrong').catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ApiError);
    expect(failure).not.toBeInstanceOf(UnauthorizedError);
    expect((failure as ApiError).code).toBe('wrong_code');
  });

  it.each([
    '/api/auth/login',
    '/api/auth/login/2fa',
    '/api/auth/forgot/verify',
    '/api/auth/forgot/complete',
    '/api/auth/step-up',
    '/api/auth/setup',
    '/api/auth/recover'
  ])('does not end the session for the generic 401 of %s', async (path) => {
    answer(401, { success: false, code: 'unauthorized' });
    const failure = await apiPost(path, {}, 'common.something_wrong').catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ApiError);
    expect(failure).not.toBeInstanceOf(UnauthorizedError);
  });

  it('does not end the session for a wrong password (403) or a wrong credential (401 wrong_credentials)', async () => {
    answer(403, { success: false, code: 'wrong_password' });
    await expect(apiPost('/api/auth/change-password', {}, 'common.something_wrong')).rejects.not.toBeInstanceOf(UnauthorizedError);
    answer(401, { success: false, code: 'wrong_credentials' });
    await expect(apiPost('/api/keys/recovery', {}, 'common.something_wrong')).rejects.not.toBeInstanceOf(UnauthorizedError);
  });

  it('carries the wait of a 429 as seconds', async () => {
    answer(429, { success: false, code: 'too_many_attempts' }, { 'Retry-After': '37' });
    const failure = await apiPost('/api/auth/login', {}, 'common.something_wrong').catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ApiError);
    expect((failure as ApiError).retryAfter).toBe(37);
  });
});
