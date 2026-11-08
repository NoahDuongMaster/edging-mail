import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { attachments, messages } from '../src/worker/db/schema';
import { addMessage, call, createUser, db, must, signIn } from './helpers';
import { internalBody } from './internal-helpers';

// cyber, crypto-review.md 18.1: EC-1 (two identical requests at once must not delete each other's objects) and EC-5 (the thread of a recipient
// comes from THEIR mail only; a request that fails after its R2 writes leaves no object behind).

const SUBJECT = 'Quarterly numbers';
const TEXT = 'Please keep this to yourselves.';
const FILE = new TextEncoder().encode('the spreadsheet, strictly confidential');

interface Answer {
  success: boolean;
  code?: string;
}

const send = (cookie: string, body: unknown, options: Parameters<typeof call>[1] = {}) =>
  call<Answer>('/api/messages/internal', { cookie, body, ...options });
const bucketKeys = async (): Promise<string[]> => (await env.BUCKET.list()).objects.map((object) => object.key);

async function pair() {
  const alice = await createUser('alice@example.com', { display_name: 'Alice A' });
  const bob = await createUser('bob@example.com');
  return { alice, bob, cookie: await signIn(alice) };
}

describe('two identical requests at the same time (EC-1)', () => {
  it('lets exactly one win; the loser answers 409 and removes only its own objects, and every attachment row has its object', async () => {
    const { alice, bob, cookie } = await pair();
    const body = await internalBody(alice, { to: [bob] }, { subject: SUBJECT, text: TEXT, files: [{ name: 'sheet.xlsx', bytes: FILE }] });
    const answers = await Promise.all([send(cookie, body), send(cookie, body)]);

    expect(answers.map((answer) => answer.status).toSorted((a, b) => a - b)).toEqual([200, 409]);
    expect(must(answers.find((answer) => answer.status === 409)).json.code).toBe('id_in_use');
    expect(await db().select().from(messages)).toHaveLength(2);
    const rows = await db().select().from(attachments);
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(await env.BUCKET.head(row.r2_key), row.r2_key).not.toBeNull();
      // each object has its own random part: `em1/<owner>/<row>/att/<attachment>/<random>`
      expect(row.r2_key).toMatch(/^em1\/[\w-]+\/[\w-]+\/att\/[\w-]+\/[\da-f-]{36}$/);
    }
    // nothing is left of the loser
    expect((await bucketKeys()).toSorted()).toEqual(rows.map((row) => row.r2_key).toSorted());
  });
});

describe('what a failed request leaves behind (EC-5)', () => {
  it('removes every object it wrote when the database write fails AFTER the R2 writes', async () => {
    const { alice, bob, cookie } = await pair();
    const body = await internalBody(
      alice,
      { to: [bob] },
      {
        subject: SUBJECT,
        text: TEXT,
        files: [
          { name: 'a.bin', bytes: FILE },
          { name: 'b.bin', bytes: FILE }
        ]
      }
    );
    let puts = 0;
    const counting = new Proxy(env.BUCKET, {
      get(target, property) {
        const value: unknown = Reflect.get(target, property);
        if (property === 'put') {
          return (...args: Parameters<R2Bucket['put']>) => {
            puts += 1;
            return target.put(...args);
          };
        }
        return typeof value === 'function' ? (value as (...inner: unknown[]) => unknown).bind(target) : value;
      }
    });
    // the one batch that stores the rows fails; everything before it (session, throttle, id checks, R2 writes) works
    const failing = new Proxy(env.DB, {
      get(target, property) {
        if (property === 'batch') {
          return () => Promise.reject(new Error('the storage batch failed'));
        }
        const value: unknown = Reflect.get(target, property);
        return typeof value === 'function' ? (value as (...inner: unknown[]) => unknown).bind(target) : value;
      }
    });
    const answer = await send(cookie, body, { env: { DB: failing, BUCKET: counting } });

    expect([answer.status, answer.json.code]).toEqual([500, 'server_error']);
    expect(puts).toBe(4);
    expect(await bucketKeys()).toEqual([]);
    expect(await db().select().from(messages)).toEqual([]);
    expect(await db().select().from(attachments)).toEqual([]);
  });

  it('takes the thread of a reply from the recipient\u2019s own mail only: a message id that exists only in the sender\u2019s mailbox gives them a new thread', async () => {
    const { alice, bob, cookie } = await pair();
    await addMessage(alice.id, {
      message_id: '<only-alice@example.org>',
      thread_id: 'alice-private-thread',
      references_header: '<alice-private-reference@example.org>'
    });
    const answer = await send(
      cookie,
      await internalBody(alice, { to: [bob] }, { subject: `Re: ${SUBJECT}`, text: TEXT }, { in_reply_to: '<only-alice@example.org>' })
    );
    expect(answer.status).toBe(200);
    const rows = await db().select().from(messages);
    const theirs = must(rows.find((row) => row.user_id === bob.id));
    expect(theirs.thread_id).toBe(theirs.message_id);
    expect(theirs.thread_id).not.toBe('alice-private-thread');
    expect(theirs.references_header ?? '').not.toContain('alice-private-reference');
    // the sender keeps her own thread
    const sent = must(rows.find((row) => row.user_id === alice.id && row.folder === 'sent'));
    expect(sent.thread_id).toBe('alice-private-thread');
  });
});
