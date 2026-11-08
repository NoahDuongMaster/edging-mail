import { QueryClient } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { deriveCredentials } from '../../src/shared/crypto/client';
import type { AccountNotice } from '../../src/client/lib/activity';
import { ApiError } from '../../src/client/lib/api';
import { requestLockedDelete } from '../../src/client/lib/crypto/account';
import { retryAfterOf } from '../../src/client/lib/crypto/errors';
import { activityKey } from '../../src/client/lib/activity';
import { tr } from '../../src/client/lib/i18n';
import { keepLockedMail, lockedMailKept, setKeptStorage } from '../../src/client/lib/lockedKept';
import {
  afterLockedChange,
  bannerRows,
  cancelLockedDelete,
  isOwnAddress,
  loadLockedMail,
  lockedMailKey,
  lockedMailOf,
  pendingFor
} from '../../src/client/lib/lockedMail';
import type { LockedMail } from '../../src/client/lib/lockedMail';
import { bannerNotices, noticesKey } from '../../src/client/lib/notices';
import type { RetiredKey } from '../../src/client/lib/crypto/unlock';

// The locked-old-mail banner (spec P7): what it shows, when it keeps quiet, and the two requests behind its buttons. The requests are checked against
// the Worker's contract (e2e-contract.md section 9): Delete sends `{ current_auth, key_id }` after the second step, Cancel sends `{ key_id }` only.

const PASSWORD = 'canary-Locked-Password-5521-correct';
const ADDRESS = 'dana@example.com';
const OLD = 'AAAAAAAAAAAAAAAAAAAAAA';
const OLDER = 'BBBBBBBBBBBBBBBBBBBBBB';

const retired = (over: Partial<RetiredKey> & { key_id: string }): RetiredKey => ({
  wrapped_private_key_recovery: 'wrapped-recovery-blob',
  retired_at: 1_700_000_000_000,
  locked: 0,
  delete_requested_at: null,
  delete_after: null,
  ...over
});

const notice = (kind: string, id: number, detail: Record<string, unknown> = {}): AccountNotice => ({
  id,
  kind,
  at: 1_700_000_000_000,
  detail
});

interface Call {
  url: string;
  body: Record<string, unknown>;
}

/** A fetch that records each call (url and JSON body) and answers by url. */
function server(answer: (url: string) => Response): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      calls.push({ url, body: typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : {} });
      return Promise.resolve(answer(url));
    })
  );
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
  setKeptStorage(undefined);
});

describe('which retired keys the banner knows about', () => {
  it('keeps a key that has mail under it or a deletion waiting, and nothing else', () => {
    const keys = [
      retired({ key_id: OLD, locked: 3 }),
      retired({ key_id: OLDER, locked: 0, delete_after: 1_700_600_000_000 }),
      retired({ key_id: 'CCCCCCCCCCCCCCCCCCCCCC', locked: 0 })
    ];
    expect(lockedMailOf(keys)).toEqual([
      { keyId: OLD, locked: 3, deleteAfter: null },
      { keyId: OLDER, locked: 0, deleteAfter: 1_700_600_000_000 }
    ]);
    expect(lockedMailOf([])).toEqual([]);
  });

  it('reads the keys of the person and drops the wrapped keys before anything is cached', async () => {
    server(() =>
      Response.json({
        success: true,
        keys: { public_key: 'p', key_id: 'k', wrapped_private_key_pw: 'secret-wrap', keys_version: 1 },
        retired: [retired({ key_id: OLD, locked: 2 })]
      })
    );
    const mail = await loadLockedMail();
    expect(mail).toEqual([{ keyId: OLD, locked: 2, deleteAfter: null }]);
    expect(JSON.stringify(mail)).not.toMatch(/wrap|secret|recovery/);
  });
});

const never = (): boolean => false;

describe('the rows of the banner', () => {
  const ask: LockedMail = { keyId: OLD, locked: 4, deleteAfter: null };
  const pending: LockedMail = { keyId: OLDER, locked: 4, deleteAfter: 1_700_600_000_000 };

  it('asks Keep or Delete while the mail is there, and shows the date and a Cancel while a deletion waits', () => {
    expect(bannerRows([ask], [], never)).toEqual([{ state: 'ask', mail: ask }]);
    expect(bannerRows([pending], [], never)).toEqual([{ state: 'pending', mail: pending, until: 1_700_600_000_000 }]);
    expect(bannerRows([ask, pending], [], never).map((row) => row.state)).toEqual(['ask', 'pending']);
  });

  it('puts a key the person chose to keep out of the way, but never a deletion that waits', () => {
    expect(bannerRows([ask], [], (keyId) => keyId === OLD)).toEqual([]);
    expect(bannerRows([pending], [], () => true)).toHaveLength(1);
  });

  it('leaves a waiting deletion to its own notice while that notice is on screen (one Cancel button, not two)', () => {
    const announced = notice('locked_delete_requested', 7, { key_id: OLDER });
    expect(bannerRows([pending], [announced], never)).toEqual([]);
    // A notice about another key, or another kind, does not cover it.
    expect(bannerRows([pending], [notice('locked_delete_requested', 8, { key_id: OLD })], never)).toHaveLength(1);
    expect(bannerRows([pending], [notice('recovery_started', 9, { key_id: OLDER })], never)).toHaveLength(1);
  });

  it('knows which waiting deletion a notice is about, and nothing once it was cancelled or done', () => {
    const about = notice('locked_delete_requested', 7, { key_id: OLDER });
    expect(pendingFor(about, [ask, pending])).toBe(pending);
    expect(pendingFor(about, [ask])).toBeUndefined();
    expect(pendingFor(about, [{ ...pending, deleteAfter: null }])).toBeUndefined();
    expect(pendingFor(notice('locked_delete_requested', 7, {}), [pending])).toBeUndefined();
    expect(pendingFor({ ...about, detail: undefined }, [pending])).toBeUndefined();
  });
});

describe('the notices banner makes room for a button that stops something', () => {
  it('puts a pending two-factor reset and a pending deletion first, and counts what is left out', () => {
    const list = [
      notice('recovery_started', 1),
      notice('password_recovered', 2),
      notice('locked_delete_requested', 3, { key_id: OLD }),
      notice('2fa_reset_pending', 4),
      notice('recovery_key_replaced', 5),
      notice('first_sign_in', 6)
    ];
    const { shown, rest } = bannerNotices(list);
    expect(new Set(shown.slice(0, 2).map((entry) => entry.kind))).toEqual(new Set(['locked_delete_requested', '2fa_reset_pending']));
    // The first sign-in is only in Settings; five notices for the banner, three shown.
    expect(shown).toHaveLength(3);
    expect(rest).toBe(2);
    expect(bannerNotices([]).rest).toBe(0);
  });
});

describe('Keep lasts as long as the tab', () => {
  it('is remembered per key, and forgotten when the storage is blocked', () => {
    const values = new Map<string, string>();
    setKeptStorage({ getItem: (name) => values.get(name) ?? null, setItem: (name, value) => values.set(name, value) });
    expect(lockedMailKept(OLD)).toBe(false);
    keepLockedMail(OLD);
    expect(lockedMailKept(OLD)).toBe(true);
    expect(lockedMailKept(OLDER)).toBe(false);
    // A key id is a public fingerprint: that is all that is stored.
    expect([...values.values()]).toEqual(['1']);

    setKeptStorage(null);
    keepLockedMail(OLD);
    expect(lockedMailKept(OLD)).toBe(false);
    setKeptStorage({
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      }
    });
    expect(lockedMailKept(OLD)).toBe(false);
    expect(() => {
      keepLockedMail(OLD);
    }).not.toThrow();
  });
});

describe('typing the address to confirm', () => {
  it('accepts the own address in any case and with spaces around it, nothing else', () => {
    expect(isOwnAddress('dana@example.com', ADDRESS)).toBe(true);
    expect(isOwnAddress('  Dana@Example.COM ', ADDRESS)).toBe(true);
    expect(isOwnAddress('dana@example.org', ADDRESS)).toBe(false);
    expect(isOwnAddress('dana', ADDRESS)).toBe(false);
    expect(isOwnAddress('', ADDRESS)).toBe(false);
    expect(isOwnAddress('', '')).toBe(false);
  });
});

describe('Delete: the password, the second step, then the request', () => {
  const marked = { success: true, key_id: OLD, locked: 3, delete_requested_at: 1_700_000_000_000, delete_after: 1_700_604_800_000 };

  it('sends only current_auth and key_id, and returns the date the server will delete', async () => {
    const calls = server(() => Response.json(marked));
    const answer = await requestLockedDelete({ email: ADDRESS, totp_enabled: false }, PASSWORD, '', OLD);
    expect(answer.delete_after).toBe(1_700_604_800_000);
    expect(calls.map((call) => call.url)).toEqual(['/api/keys/delete-locked']);
    const [call] = calls;
    expect(Object.keys(call.body).toSorted()).toEqual(['current_auth', 'key_id']);
    expect(call.body.key_id).toBe(OLD);
    expect(call.body.current_auth).toBe((await deriveCredentials(PASSWORD, ADDRESS)).auth);
    expect(JSON.stringify(calls)).not.toContain(PASSWORD);
  }, 60_000);

  it('shows a fresh code first when the account has two-factor sign-in, and never sends the delete request without it', async () => {
    const calls = server(() => Response.json(marked));
    await requestLockedDelete({ email: ADDRESS, totp_enabled: true }, PASSWORD, '123456', OLD);
    expect(calls.map((call) => call.url)).toEqual(['/api/auth/step-up', '/api/keys/delete-locked']);
    expect(calls[0]?.body).toEqual({ code: '123456' });
    expect(JSON.stringify(calls)).not.toContain(PASSWORD);

    const refused = server((url) =>
      url === '/api/auth/step-up' ? Response.json({ success: false, code: 'invalid_request' }, { status: 400 }) : Response.json(marked)
    );
    await expect(requestLockedDelete({ email: ADDRESS, totp_enabled: true }, PASSWORD, '000000', OLD)).rejects.toBeInstanceOf(ApiError);
    expect(refused.map((call) => call.url)).toEqual(['/api/auth/step-up']);
  }, 60_000);

  it('says what the server said: a wrong password, a missing second step, a wait', async () => {
    server(() => Response.json({ success: false, code: 'wrong_password' }, { status: 403 }));
    await expect(requestLockedDelete({ email: ADDRESS, totp_enabled: false }, PASSWORD, '', OLD)).rejects.toMatchObject({
      message: tr('err.wrong_password'),
      status: 403
    });

    server(() => Response.json({ success: false, code: 'step_up_required' }, { status: 403 }));
    await expect(requestLockedDelete({ email: ADDRESS, totp_enabled: false }, PASSWORD, '', OLD)).rejects.toMatchObject({
      message: tr('err.step_up_required')
    });

    server(() => Response.json({ success: false, code: 'too_many_attempts' }, { status: 429, headers: { 'Retry-After': '30' } }));
    const waiting = await requestLockedDelete({ email: ADDRESS, totp_enabled: false }, PASSWORD, '', OLD).catch((error: unknown) => error);
    expect(retryAfterOf(waiting)).toBe(30);
  }, 60_000);
});

describe('Cancel: the session is enough', () => {
  it('sends only the key id', async () => {
    const calls = server(() => Response.json({ success: true, key_id: OLD }));
    await cancelLockedDelete(OLD);
    expect(calls).toEqual([{ url: '/api/keys/cancel-delete-locked', body: { key_id: OLD } }]);
  });

  it('says so when nothing is pending any more', async () => {
    server(() => Response.json({ success: false, code: 'conflict' }, { status: 409 }));
    await expect(cancelLockedDelete(OLD)).rejects.toMatchObject({ message: tr('err.conflict'), status: 409 });
  });
});

describe('after a request', () => {
  it('reads the list, the notices and the sign-in history again', async () => {
    const queryClient = new QueryClient();
    for (const key of [lockedMailKey, noticesKey, activityKey]) {
      queryClient.setQueryData(key, []);
    }
    queryClient.setQueryData(['mail'], []);
    await afterLockedChange(queryClient);
    for (const key of [lockedMailKey, noticesKey, activityKey]) {
      expect(queryClient.getQueryState(key)?.isInvalidated, key.join('/')).toBe(true);
    }
    expect(queryClient.getQueryState(['mail'])?.isInvalidated).toBe(false);
  });
});
