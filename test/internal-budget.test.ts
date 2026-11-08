import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { loginAttempts, messages } from '../src/worker/db/schema';
import { spendBudget } from '../src/worker/auth/throttle';
import { INTERNAL_DAILY_BYTES, INTERNAL_DAILY_WINDOW_MS } from '../src/worker/mail/internal-limits';
import { call, createUser, db, must, signIn } from './helpers';
import { internalBody } from './internal-helpers';

// EC-6: what one person may send end to end in a day (request bytes, fixed 24 hour window), and the counter behind it.

const HOUR = 3_600_000;
const budgetKey = (id: string): string => `internalbytes:${id}`;
const counter = (id: string) =>
  db()
    .select()
    .from(loginAttempts)
    .where(eq(loginAttempts.key, budgetKey(id)))
    .get();

describe('the budget counter', () => {
  it('adds up inside the window, refuses what would pass the limit without adding it, and starts again when the window is over', async () => {
    const t0 = 1_000_000;
    expect(await spendBudget(db(), 'b:1', 60, 100, t0, HOUR)).toEqual({ ok: true, retryAfter: 0 });
    expect(await spendBudget(db(), 'b:1', 40, 100, t0 + 1000, HOUR)).toEqual({ ok: true, retryAfter: 0 });
    // full: a single byte more is refused, and the refusal costs nothing
    const refused = await spendBudget(db(), 'b:1', 1, 100, t0 + 2000, HOUR);
    expect(refused.ok).toBe(false);
    expect(refused.retryAfter).toBe(Math.ceil((HOUR - 2000) / 1000));
    expect(must(await db().select().from(loginAttempts).where(eq(loginAttempts.key, 'b:1')).get()).failures).toBe(100);
    // more than the whole limit never fits, not even on an empty counter
    expect((await spendBudget(db(), 'b:2', 101, 100, t0, HOUR)).ok).toBe(false);
    expect(await db().select().from(loginAttempts).where(eq(loginAttempts.key, 'b:2')).get()).toBeUndefined();
    // the window is over: the counter starts again with this amount
    expect(await spendBudget(db(), 'b:1', 30, 100, t0 + HOUR + 1, HOUR)).toEqual({ ok: true, retryAfter: 0 });
    expect(must(await db().select().from(loginAttempts).where(eq(loginAttempts.key, 'b:1')).get()).failures).toBe(30);
  });

  it('lets only as many parallel spends through as fit', async () => {
    const answers = await Promise.all(Array.from({ length: 10 }, () => spendBudget(db(), 'b:3', 30, 100, 5_000_000, HOUR)));
    expect(answers.filter((answer) => answer.ok)).toHaveLength(3);
    expect(must(await db().select().from(loginAttempts).where(eq(loginAttempts.key, 'b:3')).get()).failures).toBe(90);
  });
});

describe('POST /api/messages/internal and the daily budget', () => {
  it('counts the bytes of every stored send, and refuses with 429 and Retry-After once the day is used up, storing nothing', async () => {
    const alice = await createUser('alice@example.com');
    const bob = await createUser('bob@example.com');
    const cookie = await signIn(alice);
    const body = await internalBody(alice, { to: [bob] }, { subject: 'Hello', text: 'A short note.' });
    const first = await call<{ success: boolean }>('/api/messages/internal', { cookie, body });
    expect(first.status).toBe(200);
    const spent = must(await counter(alice.id)).failures;
    expect(spent).toBe(JSON.stringify(body).length);
    // nobody else was charged
    expect(await counter(bob.id)).toBeUndefined();

    // the counter is nearly full: this send does not fit
    await db()
      .update(loginAttempts)
      .set({ failures: INTERNAL_DAILY_BYTES - 10, window_start: Date.now() - HOUR })
      .where(eq(loginAttempts.key, budgetKey(alice.id)));
    const rowsBefore = (await db().select().from(messages)).length;
    const refused = await call<{ code?: string }>('/api/messages/internal', {
      cookie,
      body: await internalBody(alice, { to: [bob] }, { subject: 'Second', text: 'One more.' })
    });
    expect(refused.status).toBe(429);
    expect(refused.json.code).toBe('too_many_requests');
    const wait = Number(refused.headers.get('Retry-After'));
    expect(wait).toBeGreaterThan((INTERNAL_DAILY_WINDOW_MS - HOUR) / 1000 - 5);
    expect(wait).toBeLessThanOrEqual((INTERNAL_DAILY_WINDOW_MS - HOUR) / 1000);
    expect((await db().select().from(messages)).length).toBe(rowsBefore);
    expect(must(await counter(alice.id)).failures).toBe(INTERNAL_DAILY_BYTES - 10);

    // another person is not affected, and the day ending frees the person again
    const bobCookie = await signIn(bob);
    expect(
      (
        await call('/api/messages/internal', {
          cookie: bobCookie,
          body: await internalBody(bob, { to: [alice] }, { subject: 'Hi', text: 'Hello' })
        })
      ).status
    ).toBe(200);
    await db()
      .update(loginAttempts)
      .set({ window_start: Date.now() - INTERNAL_DAILY_WINDOW_MS - 1000 })
      .where(eq(loginAttempts.key, budgetKey(alice.id)));
    const again = await call('/api/messages/internal', {
      cookie,
      body: await internalBody(alice, { to: [bob] }, { subject: 'Third', text: 'Back again.' })
    });
    expect(again.status).toBe(200);
  });

  it('does not charge a request that is refused for another reason', async () => {
    const alice = await createUser('alice@example.com');
    const cookie = await signIn(alice);
    const out = await call('/api/messages/internal', { cookie, body: { not: 'a request' } });
    expect(out.status).toBe(400);
    expect(await counter(alice.id)).toBeUndefined();
  });
});
