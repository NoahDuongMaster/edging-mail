import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { mailFilters, messages, users } from '../src/worker/db/schema';
import { addMessage, call, createUser, db, deliverMail, messageRow, must, signIn } from './helpers';
import type { TestUser } from './helpers';
import { mime } from './spam-helpers';

// The routes of the spam filter: the person's lists (/api/filters), the spam_filter setting (/api/settings) and the batch action not_spam.

interface Filter {
  id: string;
  kind: string;
  value: string;
  created_at: number;
}

const list = async (cookie: string): Promise<Filter[]> => (await call<{ filters: Filter[] }>('/api/filters', { cookie })).json.filters;
const add = (cookie: string, body: unknown) => call<{ success?: boolean; filter: Filter; code?: string }>('/api/filters', { cookie, body });
const entries = (user: TestUser) => db().select().from(mailFilters).where(eq(mailFilters.user_id, user.id));
const fill = async (user: TestUser, count: number): Promise<void> => {
  for (let start = 0; start < count; start += 15) {
    await db()
      .insert(mailFilters)
      .values(
        Array.from({ length: Math.min(15, count - start) }, (_, offset) => ({
          id: crypto.randomUUID(),
          user_id: user.id,
          kind: 'block' as const,
          value: `filler${start + offset}.example`,
          created_at: 1000 + start + offset
        }))
      );
  }
};

async function person(email = 'bob@example.com') {
  const user = await createUser(email);
  return { user, cookie: await signIn(user) };
}

describe('GET /api/filters and POST /api/filters', () => {
  it('starts empty, adds entries (trimmed, lower-cased) and lists them oldest first', async () => {
    const { cookie } = await person();
    expect((await call('/api/filters', { cookie })).json).toEqual({ success: true, filters: [] });
    const first = await add(cookie, { kind: 'block', value: '  Spammer@Example.ORG ' });
    expect(first.status).toBe(200);
    expect(first.json.success).toBe(true);
    expect(first.json.filter).toMatchObject({ kind: 'block', value: 'spammer@example.org' });
    expect(first.json.filter.id).toMatch(/^[\da-f-]{36}$/);
    expect(first.json.filter.created_at).toBeGreaterThan(0);
    expect(Object.keys(first.json).toSorted((a, b) => a.localeCompare(b))).toEqual(['filter', 'success']);
    const second = await add(cookie, { kind: 'allow', value: 'Friends.Example.com' });
    const third = await add(cookie, { kind: 'block', value: 'bad.example' });
    expect((await list(cookie)).map((filter) => [filter.kind, filter.value])).toEqual([
      ['block', 'spammer@example.org'],
      ['allow', 'friends.example.com'],
      ['block', 'bad.example']
    ]);
    expect((await list(cookie)).map((filter) => filter.id)).toEqual([first.json.filter.id, second.json.filter.id, third.json.filter.id]);
    expect(Object.keys(must((await list(cookie))[0])).toSorted()).toEqual(['created_at', 'id', 'kind', 'value']);
  });

  it('answers 200 with the entry that exists when it is added again, and keeps one row; the other kind is another entry', async () => {
    const { user, cookie } = await person();
    const first = await add(cookie, { kind: 'allow', value: 'a@example.org' });
    const again = await add(cookie, { kind: 'allow', value: ' A@EXAMPLE.ORG' });
    expect(again.status).toBe(200);
    expect(again.json.filter).toEqual(first.json.filter);
    expect(await entries(user)).toHaveLength(1);
    const other = await add(cookie, { kind: 'block', value: 'a@example.org' });
    expect(other.status).toBe(200);
    expect(other.json.filter.id).not.toBe(first.json.filter.id);
    expect(await entries(user)).toHaveLength(2);
  });

  it('refuses a value that is not a plain address or a host name with 400 invalid_filter', async () => {
    const { user, cookie } = await person();
    for (const value of [
      '',
      ' '.repeat(3),
      'localhost',
      '*.example.com',
      'https://example.com',
      'example.com/x',
      'a b@example.com',
      'Alice <a@example.com>',
      'a@',
      '@example.com',
      'a@b',
      'a@1.2.3.4',
      'bücher.example',
      'x'.repeat(256),
      `${'a'.repeat(250)}.example.com`,
      5,
      null,
      true,
      {},
      ['a@example.com']
    ]) {
      const answer = await add(cookie, { kind: 'block', value });
      expect([answer.status, answer.json.code], JSON.stringify(value)).toEqual([400, 'invalid_filter']);
    }
    for (const kind of ['', 'ALLOW', 'both', 'deny', null, 1, undefined]) {
      const answer = await add(cookie, { kind, value: 'a@example.org' });
      expect([answer.status, answer.json.code], String(kind)).toEqual([400, 'invalid_filter']);
    }
    expect(await entries(user)).toEqual([]);
  });

  it('refuses a body that is not exactly {kind, value}: 400 invalid_body', async () => {
    const { cookie } = await person();
    for (const body of [
      '[]',
      '"x"',
      'null',
      '5',
      '{bad json',
      { kind: 'allow', value: 'a@example.org', extra: 1 },
      { kind: 'allow', value: 'a@example.org', user_id: 'x' }
    ]) {
      const answer = await call('/api/filters', { cookie, body });
      expect([answer.status, answer.json.code], JSON.stringify(body)).toEqual([400, 'invalid_body']);
    }
  });

  it('keeps at most 500 entries a person: the 501st is 409 too_many_filters, an existing one is still answered, and other people do not count', async () => {
    const { user, cookie } = await person();
    const other = await createUser('carol@example.com');
    await fill(other, 20);
    await fill(user, 499);
    expect((await add(cookie, { kind: 'allow', value: 'last@example.org' })).status).toBe(200);
    expect(await entries(user)).toHaveLength(500);
    const refused = await add(cookie, { kind: 'allow', value: 'one-more@example.org' });
    expect([refused.status, refused.json.code]).toEqual([409, 'too_many_filters']);
    expect(refused.json).toMatchObject({ success: false, error: 'The list has the most entries it can have' });
    expect((await add(cookie, { kind: 'allow', value: 'last@example.org' })).status).toBe(200);
    expect((await add(cookie, { kind: 'block', value: 'filler7.example' })).status).toBe(200);
    expect(await entries(user)).toHaveLength(500);
    // room again after a delete
    const some = must((await list(cookie))[0]);
    await call(`/api/filters/${some.id}`, { method: 'DELETE', cookie });
    expect((await add(cookie, { kind: 'allow', value: 'one-more@example.org' })).status).toBe(200);
    expect(await entries(user)).toHaveLength(500);
  });

  it('two requests at the limit cannot both get in', async () => {
    const { user, cookie } = await person();
    await fill(user, 498);
    const answers = await Promise.all(
      Array.from({ length: 5 }, (_, index) => add(cookie, { kind: 'allow', value: `race${index}@example.org` }))
    );
    expect(answers.map((answer) => answer.status).toSorted((a, b) => a - b)).toEqual([200, 200, 409, 409, 409]);
    expect(await entries(user)).toHaveLength(500);
  });

  it("does not show or use another person's entries", async () => {
    const bob = await person();
    const carol = await person('carol@example.com');
    await add(bob.cookie, { kind: 'block', value: 'a@example.org' });
    expect(await list(carol.cookie)).toEqual([]);
    const same = await add(carol.cookie, { kind: 'block', value: 'a@example.org' });
    expect(same.status).toBe(200);
    expect(await entries(bob.user)).toHaveLength(1);
    expect(await entries(carol.user)).toHaveLength(1);
  });

  it('needs a session', async () => {
    expect((await call('/api/filters')).status).toBe(401);
    expect((await call('/api/filters', { body: { kind: 'allow', value: 'a@example.org' } })).status).toBe(401);
    expect((await call('/api/filters/x', { method: 'DELETE' })).status).toBe(401);
  });
});

describe('DELETE /api/filters/:id', () => {
  it('deletes the caller’s own entry, and a second try is 404 not_found', async () => {
    const { user, cookie } = await person();
    const { id } = (await add(cookie, { kind: 'block', value: 'a@example.org' })).json.filter;
    await add(cookie, { kind: 'allow', value: 'b@example.org' });
    const gone = await call(`/api/filters/${id}`, { method: 'DELETE', cookie });
    expect([gone.status, gone.json]).toEqual([200, { success: true }]);
    expect((await entries(user)).map((row) => row.value)).toEqual(['b@example.org']);
    const again = await call(`/api/filters/${id}`, { method: 'DELETE', cookie });
    expect([again.status, again.json]).toEqual([404, { success: false, error: 'Not found', code: 'not_found' }]);
  });

  it('answers another person’s id exactly like one that does not exist, and leaves it alone', async () => {
    const bob = await person();
    const carol = await person('carol@example.com');
    const { id } = (await add(carol.cookie, { kind: 'block', value: 'a@example.org' })).json.filter;
    const foreign = await call(`/api/filters/${id}`, { method: 'DELETE', cookie: bob.cookie });
    const unknown = await call(`/api/filters/${crypto.randomUUID()}`, { method: 'DELETE', cookie: bob.cookie });
    expect([foreign.status, foreign.json]).toEqual([unknown.status, unknown.json]);
    expect(foreign.status).toBe(404);
    expect(await entries(carol.user)).toHaveLength(1);
    expect((await call('/api/filters/%20', { method: 'DELETE', cookie: bob.cookie })).status).toBe(404);
  });
});

describe('the spam_filter setting', () => {
  it('is on for a person, comes back as a boolean from GET and POST, and is switched by POST', async () => {
    const { user, cookie } = await person();
    const read = await call<{ settings: Record<string, unknown> }>('/api/settings', { cookie });
    expect(read.json.settings).toEqual({ display_name: '', signature: '', email: 'bob@example.com', language: null, spam_filter: true });
    const off = await call<{ settings: Record<string, unknown> }>('/api/settings', { cookie, body: { spam_filter: false } });
    expect(off.status).toBe(200);
    expect(off.json.settings).toMatchObject({ spam_filter: false });
    expect(must(await db().select().from(users).where(eq(users.id, user.id)).get()).spam_filter).toBe(0);
    expect((await call<{ settings: Record<string, unknown> }>('/api/settings', { cookie })).json.settings).toMatchObject({
      spam_filter: false
    });
    const on = await call<{ settings: Record<string, unknown> }>('/api/settings', {
      cookie,
      body: { spam_filter: true, display_name: 'Bob' }
    });
    expect(on.json.settings).toMatchObject({ spam_filter: true, display_name: 'Bob' });
    expect(must(await db().select().from(users).where(eq(users.id, user.id)).get()).spam_filter).toBe(1);
  });

  it('refuses a value that is not true or false (400 invalid_request), and still refuses an unknown key (400 invalid_body)', async () => {
    const { user, cookie } = await person();
    for (const value of [0, 1, 'true', 'false', null, [], {}]) {
      const answer = await call('/api/settings', { cookie, body: { spam_filter: value } });
      expect([answer.status, answer.json.code], JSON.stringify(value)).toEqual([400, 'invalid_request']);
      expect(answer.json.error).toBe('spam_filter must be true or false');
    }
    expect((await call('/api/settings', { cookie, body: { spam_filter: true, other: 1 } })).json.code).toBe('invalid_body');
    expect(must(await db().select().from(users).where(eq(users.id, user.id)).get()).spam_filter).toBe(1);
  });

  it('is the person’s own: another person keeps theirs', async () => {
    const bob = await person();
    const carol = await person('carol@example.com');
    await call('/api/settings', { cookie: bob.cookie, body: { spam_filter: false } });
    expect((await call<{ settings: Record<string, unknown> }>('/api/settings', { cookie: carol.cookie })).json.settings).toMatchObject({
      spam_filter: true
    });
  });
});

const line = (id: string, kind: string, value: string): string => `${value}|${kind}|${id}`;
const spamRow = (user: TestUser, from: string, fields: Parameters<typeof addMessage>[1] = {}) =>
  addMessage(user.id, {
    folder: 'spam',
    from_address: from,
    spam_score: 7,
    spam_reasons: '["spam_phrases"]',
    origin: 'smtp',
    is_read: 0,
    ...fields
  });
const notSpam = (cookie: string, ids: string[]) =>
  call<{ count: number; allowed: { id: string; value: string }[]; unblocked: string[] }>('/api/messages/batch', {
    cookie,
    body: { action: 'not_spam', message_ids: ids }
  });

describe('the batch action not_spam', () => {
  it('moves the messages to the Inbox and allow-lists each distinct sender that is not on a hosted domain', async () => {
    const { user, cookie } = await person();
    const a1 = await spamRow(user, 'Alice@Example.ORG');
    const a2 = await spamRow(user, 'alice@example.org');
    const c = await spamRow(user, 'carol@example.net');
    const hosted = await spamRow(user, 'boss@example.com');
    const tagged = await spamRow(user, 'bounce+tag=x@mail.example.org');
    const answer = await notSpam(cookie, [a1, a2, c, hosted, tagged]);
    expect(answer.status).toBe(200);
    expect(answer.json).toMatchObject({ success: true, count: 5 });
    for (const id of [a1, a2, c, hosted, tagged]) {
      expect(await messageRow(id), id).toMatchObject({ folder: 'inbox', snoozed_until: null });
    }
    // one entry for Alice (both mails), one for each other outside sender, none for the hosted domain
    expect(answer.json.allowed.map((entry) => entry.value).toSorted()).toEqual([
      'alice@example.org',
      'bounce+tag=x@mail.example.org',
      'carol@example.net'
    ]);
    expect(Object.keys(must(answer.json.allowed[0])).toSorted((a, b) => a.localeCompare(b))).toEqual(['id', 'value']);
    const stored = await list(cookie);
    expect(stored.map((filter) => line(filter.id, filter.kind, filter.value)).toSorted((a, b) => a.localeCompare(b))).toEqual(
      answer.json.allowed.map((entry) => line(entry.id, 'allow', entry.value)).toSorted((a, b) => a.localeCompare(b))
    );
    expect(stored.some((filter) => filter.value.includes('example.com'))).toBe(false);
  });

  it('touches only the caller’s messages that are in Spam: other folders and other people’s mail are left alone and not counted', async () => {
    const bob = await person();
    const carol = await person('carol@example.com');
    const mine = await spamRow(bob.user, 'a@example.org');
    const inbox = await addMessage(bob.user.id, { folder: 'inbox', from_address: 'b@example.org', spam_score: null });
    const sent = await addMessage(bob.user.id, { folder: 'sent', from_address: 'bob@example.com' });
    const trash = await addMessage(bob.user.id, { folder: 'trash', from_address: 'c@example.org' });
    const hers = await spamRow(carol.user, 'd@example.org');
    const answer = await notSpam(bob.cookie, [mine, inbox, sent, trash, hers, crypto.randomUUID()]);
    expect(answer.json).toMatchObject({ success: true, count: 1 });
    expect(answer.json.allowed.map((entry) => entry.value)).toEqual(['a@example.org']);
    expect(await messageRow(hers)).toMatchObject({ folder: 'spam', spam_score: 7 });
    expect(await messageRow(sent)).toMatchObject({ folder: 'sent' });
    expect(await messageRow(trash)).toMatchObject({ folder: 'trash' });
    expect(await entries(carol.user)).toEqual([]);
  });

  it('answers only the entries it created: one the person already has is not listed, and not made twice', async () => {
    const { user, cookie } = await person();
    await add(cookie, { kind: 'allow', value: 'a@example.org' });
    const first = await spamRow(user, 'a@example.org');
    const second = await spamRow(user, 'b@example.org');
    const answer = await notSpam(cookie, [first, second]);
    expect(answer.json.count).toBe(2);
    expect(answer.json.allowed.map((entry) => entry.value)).toEqual(['b@example.org']);
    expect((await entries(user)).filter((row) => row.kind === 'allow')).toHaveLength(2);
  });

  it('moves a message whose sender cannot be an entry, and makes no entry for it', async () => {
    const { user, cookie } = await person();
    const ids = [
      await spamRow(user, ''),
      await spamRow(user, 'no-at-sign'),
      await spamRow(user, 'a@bücher.example'),
      await spamRow(user, 'a@1.2.3.4')
    ];
    const answer = await notSpam(cookie, ids);
    expect(answer.json).toMatchObject({ count: 4, allowed: [], unblocked: [] });
    expect(await entries(user)).toEqual([]);
    for (const id of ids) {
      expect((await messageRow(id))?.folder).toBe('inbox');
    }
  });

  it('with a full list the messages still move and the entries that do not fit are left out', async () => {
    const { user, cookie } = await person();
    await fill(user, 499);
    const ids = [await spamRow(user, 'a@example.org'), await spamRow(user, 'b@example.org'), await spamRow(user, 'c@example.org')];
    const answer = await notSpam(cookie, ids);
    expect(answer.json.count).toBe(3);
    expect(answer.json.allowed).toHaveLength(1);
    expect(await entries(user)).toHaveLength(500);
  });

  it('works through more messages than one statement binds (120 ids)', async () => {
    const { user, cookie } = await person();
    const ids = await Promise.all(Array.from({ length: 120 }, (_, index) => spamRow(user, `sender${index}@example.org`)));
    const answer = await notSpam(cookie, ids);
    expect(answer.json.count).toBe(120);
    expect(answer.json.allowed).toHaveLength(120);
    expect(
      await db()
        .select()
        .from(messages)
        .where(and(eq(messages.user_id, user.id), eq(messages.folder, 'spam')))
    ).toEqual([]);
  });

  it('is undone by moving the messages back to Spam and deleting the entries it answered', async () => {
    const { user, cookie } = await person();
    const id = await spamRow(user, 'a@example.org');
    const done = await notSpam(cookie, [id]);
    await call('/api/messages/batch', { cookie, body: { action: 'move', folder: 'spam', message_ids: [id] } });
    for (const entry of done.json.allowed) {
      expect((await call(`/api/filters/${entry.id}`, { method: 'DELETE', cookie })).status).toBe(200);
    }
    expect(await messageRow(id)).toMatchObject({ folder: 'spam' });
    expect(await entries(user)).toEqual([]);
  });

  it('takes the sender off the block list, answers which addresses it unblocked, and leaves a block of the whole host and other people’s entries', async () => {
    const { user, cookie } = await person();
    const other = await person('dana@example.com');
    const id = await spamRow(user, 'Blocked@Example.org');
    const later = await spamRow(user, 'other@example.net');
    await add(cookie, { kind: 'block', value: 'blocked@example.org' });
    await add(cookie, { kind: 'block', value: 'example.org' });
    await add(other.cookie, { kind: 'block', value: 'blocked@example.org' });
    const done = await notSpam(cookie, [id, later]);
    expect(done.json.unblocked).toEqual(['blocked@example.org']);
    expect(done.json.allowed.map((entry) => entry.value).toSorted()).toEqual(['blocked@example.org', 'other@example.net']);
    const stored = (await list(cookie)).map((filter) => `${filter.kind}:${filter.value}`).toSorted((a, b) => a.localeCompare(b));
    // the address is on the allow list only; the block of its whole host stays (the address entry is the more specific, so it wins)
    expect(stored).toEqual(['allow:blocked@example.org', 'allow:other@example.net', 'block:example.org']);
    expect((await list(other.cookie)).map((filter) => `${filter.kind}:${filter.value}`)).toEqual(['block:blocked@example.org']);
    // a second Not spam has nothing left to unblock
    await call('/api/messages/batch', { cookie, body: { action: 'move', folder: 'spam', message_ids: [id] } });
    expect((await notSpam(cookie, [id])).json).toMatchObject({ allowed: [], unblocked: [] });
  });

  it('answers unblocked even when the sender was already allowed (both lists held it), so Undo can put the block back', async () => {
    const { user, cookie } = await person();
    const id = await spamRow(user, 'both@example.org');
    await add(cookie, { kind: 'allow', value: 'both@example.org' });
    await add(cookie, { kind: 'block', value: 'both@example.org' });
    const done = await notSpam(cookie, [id]);
    expect(done.json).toMatchObject({ allowed: [], unblocked: ['both@example.org'] });
    expect((await entries(user)).map((row) => row.kind)).toEqual(['allow']);
  });

  it('makes the next mail from that sender go to the Inbox', async () => {
    const { user, cookie } = await person();
    const text = 'You have won! Claim your prize now. Wire transfer details are inside.';
    await deliverMail(user.email, mime({ subject: 'Hello', text }));
    const stored = must((await db().select().from(messages).where(eq(messages.user_id, user.id))).at(-1));
    expect(stored.folder).toBe('spam');
    await notSpam(cookie, [stored.id]);
    await deliverMail(user.email, mime({ subject: 'Hello again', text }));
    expect(must((await db().select().from(messages).where(eq(messages.user_id, user.id))).at(-1)).folder).toBe('inbox');
  });

  it('keeps the rules of the other actions: ids are required, an unknown action is refused, a body with another key is invalid', async () => {
    const { cookie } = await person();
    for (const body of [
      { action: 'not_spam' },
      { action: 'not_spam', message_ids: [] },
      { action: 'not_spam', message_ids: [1] },
      { action: 'not_spam', message_ids: 'x' }
    ]) {
      const answer = await call('/api/messages/batch', { cookie, body });
      expect([answer.status, answer.json.code], JSON.stringify(body)).toEqual([400, 'invalid_request']);
    }
    expect((await call('/api/messages/batch', { cookie, body: { action: 'not-spam', message_ids: ['x'] } })).json.code).toBe(
      'invalid_request'
    );
    expect((await call('/api/messages/batch', { cookie, body: { action: 'not_spam', message_ids: ['x'], extra: 1 } })).json.code).toBe(
      'invalid_body'
    );
    expect(
      (await call('/api/messages/batch', { cookie, body: { action: 'not_spam', message_ids: [crypto.randomUUID()] } })).json
    ).toMatchObject({ success: true, count: 0, allowed: [], unblocked: [] });
  });
});
