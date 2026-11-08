import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { attachments, messages } from '../src/worker/db/schema';
import worker from '../src/worker/index';
import type { Env } from '../src/worker/types';
import { createUser, db, rawMail, testEnv } from './helpers';

// Addendum 4.19: a storage hiccup must not bounce a customer's mail. The two D1 steps (finding the owner, writing the row) are tried up to three
// times with a pause of 100 ms and then 400 ms; ids and sealed content are fixed first, so every attempt is the same write. Whatever still fails is
// rejected for good (setReject is permanent) and the log line names the step and the error class, nothing else.

const SECRET = 'secret-text-that-must-not-reach-a-log';
const FAILED = '[edging-mail] Failed to process inbound email at stage';

afterEach(() => {
  vi.restoreAllMocks();
});

/** Hands a mail to the Worker's email() handler and says how often it was rejected, and why. */
async function send(to: string, raw: string | ReadableStream<Uint8Array>, overrides: Partial<Env> = {}): Promise<string[]> {
  const rejected: string[] = [];
  const bytes = typeof raw === 'string' ? new TextEncoder().encode(raw) : null;
  const message = {
    from: 'sender@example.org',
    to,
    headers: new Headers(),
    raw: bytes === null ? raw : new Response(bytes).body,
    rawSize: bytes?.byteLength ?? 100,
    setReject: (reason: string) => rejected.push(reason)
  } as unknown as ForwardableEmailMessage;
  await worker.email(message, testEnv(overrides));
  return rejected;
}

/** The pauses the Worker asked for (100 and 400 ms) are recorded and cut to nothing, so the suite stays fast. */
function backoffs(): number[] {
  const asked: number[] = [];
  const real = globalThis.setTimeout.bind(globalThis);
  vi.spyOn(globalThis, 'setTimeout').mockImplementation(((callback: () => void, ms?: number) => {
    if (ms === 100 || ms === 400) {
      asked.push(ms);
      return real(callback, 0);
    }
    return real(callback, ms);
  }) as typeof setTimeout);
  return asked;
}

/** A binding with some of its methods replaced; the others still run on the real binding (workerd bindings reject any other `this`). */
function front<T extends object>(target: T, replaced: Record<string, (...args: never[]) => unknown>): T {
  return new Proxy(target, {
    get(real, property) {
      const own = typeof property === 'string' ? replaced[property] : undefined;
      if (own !== undefined) {
        return own;
      }
      const value: unknown = Reflect.get(real, property);
      return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(real) : value;
    }
  });
}

interface Plan {
  /** Answer of the Nth `batch` call (1-based); `run` really executes it. */
  batch?: (call: number, run: () => Promise<unknown>) => Promise<unknown>;
  /** Called with every statement D1 is asked to prepare; throw to make it fail. */
  prepare?: (sql: string) => void;
}

const readsAddress = (sql: string): boolean => sql.includes('from "addresses"');
const readsMessage = (sql: string): boolean => sql.toLowerCase().startsWith('select') && sql.includes('"messages"');

/** The real D1 with a failure plan in front of it, and a count of the calls it saw (`owner`: lookups of an address). */
function flakyDb(plan: Plan): { DB: D1Database; calls: { batch: number; owner: number } } {
  const calls = { batch: 0, owner: 0 };
  const DB = front(env.DB, {
    batch: (statements: D1PreparedStatement[]) => {
      calls.batch += 1;
      const run = (): Promise<unknown> => env.DB.batch(statements);
      return plan.batch === undefined ? run() : plan.batch(calls.batch, run);
    },
    prepare: (sql: string) => {
      calls.owner += readsAddress(sql) ? 1 : 0;
      plan.prepare?.(sql);
      return env.DB.prepare(sql);
    }
  });
  return { DB, calls };
}

/** The first write is committed by D1 and then its answer is lost (an error); later writes really run. `committed()` says it happened. */
function lostAnswer(): { batch: NonNullable<Plan['batch']>; committed: () => boolean } {
  let committed = false;
  return {
    committed: () => committed,
    batch: (call, run) =>
      call === 1
        ? run().then(() => {
            committed = true;
            throw new Error('connection lost after commit');
          })
        : run()
  };
}

const refuses = (): Promise<never> => Promise.reject(new Error(SECRET));
const failsAddressLookup = (sql: string): void => {
  if (readsAddress(sql)) {
    throw new RangeError(SECRET);
  }
};
const objectKeys = async (): Promise<string[]> => (await env.BUCKET.list()).objects.map((object) => object.key);
const withFile = (to: string): string =>
  [
    `From: Sender <sender@example.org>\r\nTo: ${to}\r\nSubject: With a file\r\nMessage-ID: <retry-${crypto.randomUUID()}@example.org>`,
    'MIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary="b"\r\n',
    '--b\r\nContent-Type: text/plain\r\n\r\nSee the file.',
    `--b\r\nContent-Type: text/plain; name="n.txt"\r\nContent-Disposition: attachment; filename="n.txt"\r\nContent-Transfer-Encoding: base64\r\n\r\n${btoa('file')}`,
    '--b--\r\n'
  ].join('\r\n');

describe('inbound mail survives a storage hiccup (4.19)', () => {
  it('stores the mail when the first write fails and the second works: one row, its objects, one pause of 100 ms', async () => {
    const alice = await createUser('alice@example.com');
    const pauses = backoffs();
    const flaky = flakyDb({ batch: (call, run) => (call === 1 ? refuses() : run()) });
    expect(await send('alice@example.com', withFile('alice@example.com'), { DB: flaky.DB })).toEqual([]);
    expect(flaky.calls.batch).toBe(2);
    expect(pauses).toEqual([100]);
    expect((await db().select().from(messages)).map((row) => row.user_id)).toEqual([alice.id]);
    expect(await db().select().from(attachments)).toHaveLength(1);
    expect(await objectKeys()).toHaveLength(2);
  });

  it('finds the owner on the second try when the first lookup fails', async () => {
    await createUser('alice@example.com');
    const pauses = backoffs();
    const flaky = flakyDb({
      prepare: (sql) => {
        if (readsAddress(sql) && flaky.calls.owner === 1) {
          throw new Error(SECRET);
        }
      }
    });
    expect(await send('alice@example.com', rawMail({ to: 'alice@example.com' }), { DB: flaky.DB })).toEqual([]);
    expect(pauses).toEqual([100]);
    expect(await db().select().from(messages)).toHaveLength(1);
  });

  it('rejects once after three attempts when the write always fails, and leaves no row and no object', async () => {
    await createUser('alice@example.com');
    const pauses = backoffs();
    const error = vi.spyOn(console, 'error');
    const flaky = flakyDb({ batch: refuses });
    expect(await send('alice@example.com', withFile('alice@example.com'), { DB: flaky.DB })).toEqual(['Message could not be processed']);
    expect(flaky.calls.batch).toBe(3);
    expect(pauses).toEqual([100, 400]);
    expect(await db().select().from(messages)).toHaveLength(0);
    expect(await objectKeys()).toEqual([]);
    expect(error.mock.calls.filter(([line]) => String(line).startsWith(FAILED))).toEqual([[`${FAILED} store-row: Error`]]);
  });

  it('rejects once after three attempts when the owner lookup always fails', async () => {
    await createUser('alice@example.com');
    const pauses = backoffs();
    const flaky = flakyDb({ prepare: failsAddressLookup });
    expect(await send('alice@example.com', rawMail({ to: 'alice@example.com' }), { DB: flaky.DB })).toEqual([
      'Message could not be processed'
    ]);
    expect(flaky.calls.owner).toBe(3);
    expect(pauses).toEqual([100, 400]);
    expect(await db().select().from(messages)).toHaveLength(0);
  });

  it('counts a write that D1 committed but whose answer was lost as done: exactly one row, nothing written twice', async () => {
    await createUser('alice@example.com');
    const pauses = backoffs();
    const flaky = flakyDb({ batch: lostAnswer().batch });
    expect(await send('alice@example.com', withFile('alice@example.com'), { DB: flaky.DB })).toEqual([]);
    expect(await db().select().from(messages)).toHaveLength(1);
    expect(await db().select().from(attachments)).toHaveLength(1);
    expect(await objectKeys()).toHaveLength(2);
    expect(flaky.calls.batch).toBe(1);
    expect(pauses).toEqual([]);
  });

  it('counts the second attempt as done when it meets its own row, even if D1 could not say whether the row was there', async () => {
    await createUser('alice@example.com');
    const pauses = backoffs();
    const lost = lostAnswer();
    let asked = false;
    const flaky = flakyDb({
      batch: lost.batch,
      prepare: (sql) => {
        if (lost.committed() && !asked && readsMessage(sql)) {
          asked = true;
          throw new Error(SECRET);
        }
      }
    });
    expect(await send('alice@example.com', withFile('alice@example.com'), { DB: flaky.DB })).toEqual([]);
    expect(flaky.calls.batch).toBe(2);
    expect(pauses).toEqual([100]);
    expect(await db().select().from(messages)).toHaveLength(1);
    expect(await db().select().from(attachments)).toHaveLength(1);
    expect(await objectKeys()).toHaveLength(2);
  });

  it('never removes the objects of a row that may have been stored (a lost answer, and D1 cannot say)', async () => {
    await createUser('alice@example.com');
    backoffs();
    vi.spyOn(console, 'error');
    const lost = lostAnswer();
    const flaky = flakyDb({
      batch: lost.batch,
      prepare: (sql) => {
        if (lost.committed() && readsMessage(sql)) {
          throw new Error(SECRET);
        }
      }
    });
    expect(await send('alice@example.com', withFile('alice@example.com'), { DB: flaky.DB })).toEqual(['Message could not be processed']);
    expect(await db().select().from(messages)).toHaveLength(1);
    expect(await objectKeys()).toHaveLength(2);
  });

  it('does not repeat the other steps: an attachment that cannot be stored is rejected after one try', async () => {
    await createUser('alice@example.com');
    const pauses = backoffs();
    vi.spyOn(console, 'error');
    let puts = 0;
    const BUCKET = front(env.BUCKET, {
      put: (key: string, value: ArrayBuffer, options?: R2PutOptions) => {
        puts += 1;
        return key.includes('/att/') ? refuses() : env.BUCKET.put(key, value, options);
      }
    });
    expect(await send('alice@example.com', withFile('alice@example.com'), { BUCKET })).toEqual(['Message could not be processed']);
    expect(puts).toBe(2);
    expect(pauses).toEqual([]);
    expect(await objectKeys()).toEqual([]);
  });
});

describe('the failure log line names the step and the error class, nothing else (4.19)', () => {
  interface Arranged {
    raw: string | ReadableStream<Uint8Array>;
    overrides?: Partial<Env>;
    /** How often the failing operation was asked for (not counted for `parse`: a stream can be read only once). */
    asked?: () => number;
  }
  interface Case {
    stage: string;
    errorClass: string;
    /** Repeated steps (resolve, store-row) run 3 times with 2 pauses; the others run once and never pause. */
    repeated: boolean;
    /** What `asked()` must say. */
    times?: number;
    arrange: () => Arranged;
  }
  const cases: Case[] = [
    {
      stage: 'resolve',
      errorClass: 'RangeError',
      repeated: true,
      times: 3,
      arrange: () => {
        const flaky = flakyDb({ prepare: failsAddressLookup });
        return { raw: rawMail({ to: 'alice@example.com' }), overrides: { DB: flaky.DB }, asked: () => flaky.calls.owner };
      }
    },
    {
      stage: 'parse',
      errorClass: 'TypeError',
      repeated: false,
      arrange: () => ({ raw: new ReadableStream<Uint8Array>({ start: (controller) => controller.error(new TypeError(SECRET)) }) })
    },
    {
      // The HPKE library wraps a failed encryption in its own SealError, which is the class the log shows
      stage: 'seal',
      errorClass: 'SealError',
      repeated: false,
      times: 1,
      arrange: () => {
        const encrypt = vi.spyOn(crypto.subtle, 'encrypt').mockRejectedValue(new RangeError(SECRET));
        return { raw: rawMail({ to: 'alice@example.com' }), asked: () => encrypt.mock.calls.length };
      }
    },
    {
      // The raw copy is asked for first (its failure is not fatal), then the attachment: two puts, once
      stage: 'store-object',
      errorClass: 'Error',
      repeated: false,
      times: 2,
      arrange: () => {
        let puts = 0;
        const BUCKET = front(env.BUCKET, {
          put: () => {
            puts += 1;
            return refuses();
          }
        });
        return { raw: withFile('alice@example.com'), overrides: { BUCKET }, asked: () => puts };
      }
    },
    {
      stage: 'store-row',
      errorClass: 'Error',
      repeated: true,
      times: 3,
      arrange: () => {
        const flaky = flakyDb({ batch: refuses });
        return { raw: rawMail({ to: 'alice@example.com' }), overrides: { DB: flaky.DB }, asked: () => flaky.calls.batch };
      }
    }
  ];

  it.each(cases)('stage $stage ($errorClass)', async ({ stage, errorClass, repeated, times, arrange }) => {
    await createUser('alice@example.com');
    const pauses = backoffs();
    const error = vi.spyOn(console, 'error');
    const warn = vi.spyOn(console, 'warn');
    const { raw, overrides, asked } = arrange();
    expect(await send('alice@example.com', raw, overrides)).toEqual(['Message could not be processed']);
    expect(error.mock.calls.filter(([line]) => String(line).startsWith(FAILED))).toEqual([[`${FAILED} ${stage}: ${errorClass}`]]);
    // INB-1: only resolve and store-row are repeated. A repeated step always pauses and warns before its next attempt, so no pause and no
    // "trying again" line mean the step ran once (a repeated `seal` would triple the work of a 20 MiB mail on a failure that is certain to recur).
    const retries = warn.mock.calls.map(([line]) => String(line)).filter((line) => line.includes('trying again'));
    const again = (attempt: number): string =>
      `[edging-mail] Inbound email: ${stage} failed on attempt ${attempt} of 3, trying again: ${errorClass}`;
    expect(pauses).toEqual(repeated ? [100, 400] : []);
    expect(retries).toEqual(repeated ? [again(1), again(2)] : []);
    if (asked !== undefined) {
      expect(asked()).toBe(times);
    }
    // Not the message of the error, not an address, not a subject, anywhere in what was logged
    expect(JSON.stringify([...error.mock.calls, ...warn.mock.calls])).not.toMatch(/secret|alice|example\.org|With a file|Hello/);
    expect(await db().select().from(messages)).toHaveLength(0);
    expect(await objectKeys()).toEqual([]);
  });
});
