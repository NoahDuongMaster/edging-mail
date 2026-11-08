import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { sleep, WRONG_CREDENTIAL_DELAY_MS } from '../src/worker/auth/throttle';
import { auditLog } from '../src/worker/db/schema';
import { authFor, call, createUser, db } from './helpers';
import type { Answer, CallOptions } from './helpers';

// The floor of the sign-in endpoint: every refusal takes at least WRONG_CREDENTIAL_DELAY_MS, whichever branch made it, and a known address is not
// slower than an unknown one.

const FLOOR = WRONG_CREDENTIAL_DELAY_MS;
const COARSE = 20; // the clock and the timers of the test runtime are not exact

async function timed(body: unknown, ip: string, options: Pick<CallOptions, 'env'> = {}) {
  const started = Date.now();
  const answer: Answer = await call('/api/auth/login', { body, ip, ...options });
  return { answer, took: Date.now() - started };
}

const wrong = async (email: string) => ({ email, auth: await authFor(email, 'wrong password!'), kdf: 1 });

/** Five wrong attempts at one address from one client, then the sixth: the answer that comes back is the throttle's. */
async function climbThenAsk(email: string, ip: string) {
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    expect((await timed(await wrong(email), ip)).answer.status, `${email} attempt ${attempt}`).toBe(401);
  }
  return timed(await wrong(email), ip);
}

describe('the floor of POST /api/auth/login', () => {
  it('holds an unknown address, a wrong credential and a malformed request at the floor', async () => {
    const user = await createUser('alex@example.com');
    const answers = [
      ['unknown address', await timed(await wrong('nobody@example.com'), '198.51.100.1'), 401],
      ['known address', await timed(await wrong(user.email), '198.51.100.2'), 401],
      ['body without an auth value', await timed({ email: user.email }, '198.51.100.3'), 400],
      ['not an object', await timed('[1]', '198.51.100.4'), 400],
      ['a shared flag that is not a boolean', await timed({ ...(await wrong(user.email)), shared: 'yes' }, '198.51.100.5'), 400]
    ] as const;
    for (const [name, { answer, took }, status] of answers) {
      expect(answer.status, name).toBe(status);
      expect(took, name).toBeGreaterThanOrEqual(FLOOR - COARSE);
    }
  });

  it('holds the answer of a throttle at the floor too, for an unknown address and for a known one', async () => {
    const user = await createUser('alex@example.com');
    const [unknown, known] = await Promise.all([
      climbThenAsk('nobody@example.com', '198.51.100.20'),
      climbThenAsk(user.email, '198.51.100.21')
    ]);
    for (const [name, { answer, took }] of [
      ['unknown address', unknown],
      ['known address', known]
    ] as const) {
      expect(answer.status, name).toBe(429);
      expect(answer.json, name).toMatchObject({ code: 'too_many_attempts' });
      expect(Number(answer.headers.get('Retry-After')), name).toBeGreaterThan(0);
      expect(took, name).toBeGreaterThanOrEqual(FLOOR - COARSE);
    }
  });

  it('does not make a known address slower than an unknown one when the database is slow: its audit rows are written after the answer', async () => {
    const user = await createUser('alex@example.com');
    // Every batch the Worker sends to D1 takes 250 ms longer. The throttle counters (batches) slow both addresses alike; the audit and sign-in rows of
    // a known address are the extra write, and they must not be waited for.
    const slow = new Proxy(env.DB, {
      get(target, property) {
        const value: unknown = Reflect.get(target, property);
        if (property === 'batch') {
          return async (statements: D1PreparedStatement[]) => {
            await sleep(250);
            return target.batch(statements);
          };
        }
        return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
      }
    });
    const unknown = await timed(await wrong('nobody@example.com'), '198.51.100.30', { env: { DB: slow } });
    const known = await timed(await wrong(user.email), '198.51.100.31', { env: { DB: slow } });
    expect([unknown.answer.status, known.answer.status]).toEqual([401, 401]);
    expect(Math.abs(known.took - unknown.took)).toBeLessThan(150);
    // the rows were written all the same (the helper waits for the background work)
    expect((await db().select().from(auditLog)).map((row) => row.action)).toEqual(['sign_in_failed']);
  });
});
