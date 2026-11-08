import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { askSession, sessionKey } from '../../src/client/lib/auth';
import type { Session } from '../../src/client/lib/auth';
import { SESSION_CHECK_PATIENCE_MS, confirmSession, resetRenewal } from '../../src/client/lib/sessionRenewal';

// SR-1: after a sign that the session may be gone (a 4401 or 4402 close, a 401 inside a renewal) the session check is the authority. A check that
// cannot be answered (offline, a 5xx) is not "fine": it is asked again for 30 seconds, and then the keys are wiped and the app locks.

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
  resetRenewal();
});

afterEach(() => {
  vi.useRealTimers();
  resetRenewal();
});

/** A check that answers from `script` (true: the server answered, false: it could not), one entry per call, the last one repeating. */
function scripted(script: boolean[]) {
  const calls: number[] = [];
  const started = Date.now();
  const check = vi.fn(() => {
    calls.push(Date.now() - started);
    return Promise.resolve(script[Math.min(calls.length - 1, script.length - 1)] ?? true);
  });
  return { check, calls };
}

describe('the session check after a close (SR-1)', () => {
  it('asks once and leaves the keys alone when the server answers', async () => {
    const wipe = vi.fn();
    const { check } = scripted([true]);
    await confirmSession(check, wipe);
    expect(check).toHaveBeenCalledTimes(1);
    expect(wipe).not.toHaveBeenCalled();
  });

  it('asks again every few seconds while it cannot be answered, and keeps the keys when it is answered in time', async () => {
    const wipe = vi.fn();
    const { check, calls } = scripted([false, false, true]);
    const done = confirmSession(check, wipe);
    await vi.advanceTimersByTimeAsync(20_000);
    await done;
    expect(calls).toEqual([0, 3000, 6000]);
    expect(wipe).not.toHaveBeenCalled();
  });

  it('wipes the keys, once, when the check still cannot be answered after 30 seconds, and stops asking', async () => {
    const wipe = vi.fn();
    const { check, calls } = scripted([false]);
    const done = confirmSession(check, wipe);
    await vi.advanceTimersByTimeAsync(SESSION_CHECK_PATIENCE_MS - 1000);
    expect(wipe).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(10_000);
    await done;
    expect(wipe).toHaveBeenCalledTimes(1);
    const asked = calls.length;
    expect(Math.max(...calls)).toBeGreaterThanOrEqual(SESSION_CHECK_PATIENCE_MS - 3000);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls).toHaveLength(asked);
    expect(wipe).toHaveBeenCalledTimes(1);
  });

  it('is one round at a time: a second close while the check runs joins it', async () => {
    const wipe = vi.fn();
    const { check } = scripted([false, true]);
    const first = confirmSession(check, wipe);
    const second = confirmSession(check, wipe);
    expect(second).toBe(first);
    await vi.advanceTimersByTimeAsync(5000);
    await first;
    expect(check).toHaveBeenCalledTimes(2);
    // Done: the next close starts a round of its own.
    const third = scripted([true]);
    await confirmSession(third.check, wipe);
    expect(third.check).toHaveBeenCalledTimes(1);
  });

  it('starts the 30 seconds again for a later close', async () => {
    const wipe = vi.fn();
    const { check } = scripted([false, true]);
    const done = confirmSession(check, wipe);
    await vi.advanceTimersByTimeAsync(5000);
    await done;
    vi.setSystemTime(Date.now() + 120_000);
    const later = scripted([false, false, true]);
    const second = confirmSession(later.check, wipe);
    await vi.advanceTimersByTimeAsync(10_000);
    await second;
    expect(wipe).not.toHaveBeenCalled();
  });
});

const ignore = (): void => {
  // The page's own session query is mounted, nobody reads its updates here.
};

describe('askSession: did the server answer?', () => {
  const signedIn: Session = { authenticated: true };

  /** The page's own session query (App keeps one mounted): a stand-in that answers from `answer`. */
  function pageWith(answer: () => Promise<Session>): QueryClient {
    const queryClient = new QueryClient();
    const observer = new QueryObserver(queryClient, { queryKey: sessionKey, queryFn: answer, retry: false, staleTime: Infinity });
    observer.subscribe(ignore);
    return queryClient;
  }

  it('is true when the server answered, signed in or not', async () => {
    let answers: Session = signedIn;
    const queryClient = pageWith(() => Promise.resolve(answers));
    await vi.waitFor(() => {
      expect(queryClient.getQueryState(sessionKey)?.status).toBe('success');
    });
    expect(await askSession(queryClient)).toBe(true);
    answers = { authenticated: false };
    expect(await askSession(queryClient)).toBe(true);
    expect(queryClient.getQueryData<Session>(sessionKey)?.authenticated).toBe(false);
  });

  it('is false when the question itself failed (offline, a 5xx), and true again once it can be answered', async () => {
    let failing = false;
    const queryClient = pageWith(() => (failing ? Promise.reject(new TypeError('Failed to fetch')) : Promise.resolve(signedIn)));
    await vi.waitFor(() => {
      expect(queryClient.getQueryState(sessionKey)?.status).toBe('success');
    });
    failing = true;
    expect(await askSession(queryClient)).toBe(false);
    // The last good answer stays in the cache: a failed check says nothing about the session.
    expect(queryClient.getQueryData<Session>(sessionKey)?.authenticated).toBe(true);
    failing = false;
    expect(await askSession(queryClient)).toBe(true);
  });
});
