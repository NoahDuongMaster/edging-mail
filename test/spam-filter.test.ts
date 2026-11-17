import { createExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mailFilters, messages, users } from '../src/worker/db/schema';
import worker from '../src/worker/index';
import {
  addMessage,
  call,
  createUser,
  decryptPush,
  db,
  deliverMail,
  fakePushService,
  must,
  openRow,
  ORIGIN,
  signIn,
  subscribeDevice,
  testEnv,
  waitUntil
} from './helpers';
import type { TestUser } from './helpers';
import { CLOUDFLARE_FAIL, CLOUDFLARE_NONE, CLOUDFLARE_PASS, mime } from './spam-helpers';

// Mail that arrives by email, through the real `email()` handler: the spam filter decides the folder, the mail is sealed and stored the same either way,
// a spam verdict sends no push, and nothing can make the filter lose or refuse a mail.

const SPAM_TEXT = 'You have won! Claim your prize now. Wire transfer details are inside.';
const TO = 'bob@example.com';
const spam = (options: Parameters<typeof mime>[0] = {}): string => mime({ subject: 'Hello', text: SPAM_TEXT, ...options });
const ham = (options: Parameters<typeof mime>[0] = {}): string => mime({ subject: 'Lunch on Friday', ...options });

const entry = (user: TestUser, kind: 'allow' | 'block', value: string, created_at = Date.now()) =>
  db().insert(mailFilters).values({ id: crypto.randomUUID(), user_id: user.id, kind, value, created_at });
const settle = (): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, 250);
  });

async function openTab(cookie: string): Promise<{ events: { type: string }[]; close: () => void }> {
  const response = await worker.fetch(
    new Request(`${ORIGIN}/api/ws`, {
      headers: { Upgrade: 'websocket', Cookie: cookie, Origin: ORIGIN, 'CF-Connecting-IP': '203.0.113.7' }
    }),
    testEnv(),
    createExecutionContext()
  );
  const socket = must(response.webSocket, 'a websocket');
  const events: { type: string }[] = [];
  socket.addEventListener('message', (event) => {
    events.push(JSON.parse(String(event.data)) as { type: string });
  });
  socket.accept();
  await waitUntil(() => events.some((event) => event.type === 'hello'));
  return { events, close: () => socket.close(1000, 'done') };
}

const rows = () => db().select().from(messages);
const lastRow = async () => must((await rows()).at(-1), 'a stored message');

afterEach(() => {
  vi.restoreAllMocks();
});

async function bob(): Promise<TestUser> {
  return createUser(TO);
}

describe('delivery to the Spam folder', () => {
  it('puts mail the rules call spam in Spam, with its score and reasons, and stores it sealed like any other mail', async () => {
    const person = await bob();
    expect((await deliverMail(TO, spam({ attachments: [{ name: 'note.txt', content: 'attachment content' }] }))).rejected).toBeUndefined();
    const row = await lastRow();
    expect(row).toMatchObject({
      user_id: person.id,
      folder: 'spam',
      is_read: 0,
      origin: 'smtp',
      spam_score: 6,
      spam_reasons: '["spam_phrases"]',
      auth: null,
      enc_fmt: 1,
      wrap_kind: 'user',
      has_attachments: 1,
      subject: null,
      body_text: null
    });
    expect(row.r2_key).toBe(`em1/${person.id}/${row.id}/raw`);
    expect(await env.BUCKET.get(row.r2_key ?? 'none')).not.toBeNull();
    // the verdict holds rule ids only: no word of the mail is anywhere in the row
    expect(JSON.stringify(row)).not.toContain('Claim your prize');
    expect(JSON.stringify(row)).not.toContain('wire transfer');
    // and the mail opens like any other
    const content = await openRow(row, person);
    expect(content).toMatchObject({ subject: 'Hello' });
    expect(content.text).toContain('Claim your prize');
  });

  it('keeps ham in the Inbox with no verdict', async () => {
    await bob();
    await deliverMail(TO, ham());
    expect(await lastRow()).toMatchObject({ folder: 'inbox', spam_score: null, spam_reasons: null });
  });

  it('shows the verdict in the list, in the message and in the folder counts', async () => {
    const person = await bob();
    const cookie = await signIn(person);
    await deliverMail(TO, spam({ headers: [CLOUDFLARE_NONE] }));
    await deliverMail(TO, ham({ headers: [CLOUDFLARE_PASS] }));
    const spamList = await call<{ messages: Record<string, unknown>[] }>('/api/messages?folder=spam', { cookie });
    expect(spamList.json.messages).toHaveLength(1);
    // no authentication result passed (none, none, none): auth_missing_pass 3 + the three phrases 6
    expect(spamList.json.messages[0]).toMatchObject({
      folder: 'spam',
      spam_score: 9,
      spam_reasons: '["spam_phrases","auth_missing_pass"]',
      auth: 'spf=none;dkim=none;dmarc=none'
    });
    const inbox = await call<{ messages: Record<string, unknown>[] }>('/api/messages?folder=inbox', { cookie });
    expect(inbox.json.messages).toHaveLength(1);
    expect(inbox.json.messages[0]).toMatchObject({ spam_score: null, spam_reasons: null, auth: 'spf=pass;dkim=pass;dmarc=pass' });
    const detail = await call<{ message: Record<string, unknown> }>(`/api/messages/${String(spamList.json.messages[0]?.id)}?peek=1`, {
      cookie
    });
    expect(detail.json.message).toMatchObject({ spam_score: 9, spam_reasons: '["spam_phrases","auth_missing_pass"]' });
    const stats = await call<{ stats: Record<string, { total: number; unread: number }> }>('/api/stats', { cookie });
    expect(stats.json.stats.spam).toEqual({ total: 1, unread: 1 });
    expect(stats.json.stats.inbox).toEqual({ total: 1, unread: 1 });
  });
});

describe('the authentication result Cloudflare recorded', () => {
  it('is stored compactly for our header, and a mechanism it did not report is none', async () => {
    await bob();
    await deliverMail(TO, ham({ headers: ['Authentication-Results: mx.cloudflare.net; dmarc=fail header.from=example.org'] }));
    expect((await lastRow()).auth).toBe('spf=none;dkim=none;dmarc=fail');
  });

  it('is NULL when the mail carries none of ours: another server’s header, or ours below the first one', async () => {
    await bob();
    await deliverMail(TO, ham());
    expect((await lastRow()).auth).toBeNull();
    await deliverMail(TO, ham({ headers: ['Authentication-Results: mail.example.org; spf=pass; dkim=pass; dmarc=pass'] }));
    expect((await lastRow()).auth).toBeNull();
    // the sender wrote a header with our name BELOW another server's: the first one decides, and it is not ours
    await deliverMail(TO, ham({ headers: ['Authentication-Results: mail.example.org; dmarc=pass', CLOUDFLARE_PASS] }));
    expect((await lastRow()).auth).toBeNull();
  });

  it('is kept for mail the filter does not scan too (before Setup, and with the setting off)', async () => {
    await deliverMail('anyone@example.com', spam({ to: 'anyone@example.com', headers: [CLOUDFLARE_PASS] }));
    expect(await lastRow()).toMatchObject({ user_id: null, folder: 'inbox', auth: 'spf=pass;dkim=pass;dmarc=pass', spam_score: null });
    await db().delete(messages);
    const person = await bob();
    await db().update(users).set({ spam_filter: 0 }).where(eq(users.id, person.id));
    await deliverMail(TO, spam({ headers: [CLOUDFLARE_FAIL] }));
    expect(await lastRow()).toMatchObject({ folder: 'inbox', auth: 'spf=fail;dkim=none;dmarc=fail', spam_score: null });
  });

  it('a failed DMARC is spam by itself; a passed one takes 2 away', async () => {
    await bob();
    await deliverMail(TO, ham({ headers: [CLOUDFLARE_FAIL] }));
    expect(await lastRow()).toMatchObject({ folder: 'spam', spam_score: 6, spam_reasons: '["auth_failed","auth_missing_pass"]' });
    // three phrases are 6; with dmarc=pass that is 4: not spam
    await deliverMail(TO, spam({ headers: [CLOUDFLARE_PASS] }));
    expect(await lastRow()).toMatchObject({ folder: 'inbox', spam_score: null });
    await deliverMail(TO, spam());
    expect(await lastRow()).toMatchObject({ folder: 'spam', spam_score: 6 });
  });

  it('mail that claims a hosted domain without a DMARC pass is spam, also for somebody the person has written to', async () => {
    const person = await bob();
    await createUser('boss@example.com');
    const from = 'The Boss <boss@example.com>';
    await deliverMail(TO, ham({ from }));
    expect(await lastRow()).toMatchObject({ folder: 'spam', spam_score: 5, spam_reasons: '["spoofs_own_domain"]' });
    await deliverMail(TO, ham({ from, headers: [CLOUDFLARE_PASS.replace('example.org', 'example.com')] }));
    expect(await lastRow()).toMatchObject({ folder: 'inbox' });
    // writing to that address does not make a spoof of it welcome
    await addMessage(person.id, { folder: 'sent', to_address: 'boss@example.com', origin: 'smtp' });
    await deliverMail(TO, ham({ from, headers: [CLOUDFLARE_FAIL] }));
    expect(await lastRow()).toMatchObject({ folder: 'spam' });
    await deliverMail(TO, ham({ from }));
    expect(await lastRow()).toMatchObject({ folder: 'spam', spam_reasons: '["spoofs_own_domain"]' });
  });
});

describe("the person's lists, the people they wrote to and the mail they answer", () => {
  it('a block entry is spam whatever the mail is, with the one reason block_listed and a score of the threshold', async () => {
    const person = await bob();
    await entry(person, 'block', 'example.org');
    await deliverMail(TO, ham());
    expect(await lastRow()).toMatchObject({ folder: 'spam', spam_score: 5, spam_reasons: '["block_listed"]' });
    await deliverMail(TO, ham({ from: 'Sub <x@news.example.org>' }));
    expect(await lastRow()).toMatchObject({ folder: 'spam', spam_reasons: '["block_listed"]' });
    await deliverMail(TO, ham({ from: 'Other <x@notexample.org>' }));
    expect(await lastRow()).toMatchObject({ folder: 'inbox' });
  });

  it('an allow entry keeps spam-looking mail in the Inbox, with no verdict stored', async () => {
    const person = await bob();
    await entry(person, 'allow', 'alice@example.org');
    await deliverMail(TO, spam());
    expect(await lastRow()).toMatchObject({ folder: 'inbox', spam_score: null, spam_reasons: null });
    await deliverMail(TO, spam({ from: 'Mallory <mallory@example.org>' }));
    expect(await lastRow()).toMatchObject({ folder: 'spam' });
    await entry(person, 'allow', 'example.org');
    await deliverMail(TO, spam({ from: 'Mallory <mallory@example.org>' }));
    expect(await lastRow()).toMatchObject({ folder: 'inbox' });
  });

  it('the most specific entry wins: a block of a host does not stop an allowed address', async () => {
    const person = await bob();
    await entry(person, 'block', 'example.org');
    await entry(person, 'allow', 'alice@example.org');
    await deliverMail(TO, ham());
    expect(await lastRow()).toMatchObject({ folder: 'inbox' });
    await deliverMail(TO, ham({ from: 'Mallory <mallory@example.org>' }));
    expect(await lastRow()).toMatchObject({ folder: 'spam' });
  });

  it("another person's lists are not used", async () => {
    await bob();
    const carol = await createUser('carol@example.com');
    await entry(carol, 'block', 'example.org');
    await deliverMail(TO, ham());
    expect(await lastRow()).toMatchObject({ folder: 'inbox' });
    await deliverMail('carol@example.com', ham({ to: 'carol@example.com' }));
    expect(await lastRow()).toMatchObject({ folder: 'spam', spam_reasons: '["block_listed"]' });
  });

  it('a person written to before is not spam: the exact address in the to or cc list of a mail in Sent', async () => {
    const person = await bob();
    const other = await createUser('carol@example.com');
    await deliverMail(TO, spam());
    expect((await lastRow()).folder).toBe('spam');
    await db().delete(messages);
    // a similar address, a mail that is not in Sent, and somebody else's Sent do not count
    await addMessage(person.id, { folder: 'sent', to_address: 'malice@example.org, bob2@example.com', cc: 'xalice@example.org' });
    await addMessage(person.id, { folder: 'inbox', to_address: 'alice@example.org' });
    await addMessage(person.id, { folder: 'drafts', to_address: 'alice@example.org' });
    await addMessage(other.id, { folder: 'sent', to_address: 'alice@example.org' });
    await deliverMail(TO, spam());
    expect((await lastRow()).folder).toBe('spam');
    await addMessage(person.id, { folder: 'sent', to_address: 'x@example.net,  Alice@Example.ORG ' });
    await deliverMail(TO, spam());
    expect((await lastRow()).folder).toBe('inbox');
    // in cc
    await db().delete(messages).where(eq(messages.folder, 'sent'));
    await deliverMail(TO, spam());
    expect((await lastRow()).folder).toBe('spam');
    await addMessage(person.id, { folder: 'sent', to_address: 'x@example.net', cc: 'y@example.net, alice@example.org' });
    await deliverMail(TO, spam());
    expect((await lastRow()).folder).toBe('inbox');
  });

  it('a block entry beats a person written to', async () => {
    const person = await bob();
    await addMessage(person.id, { folder: 'sent', to_address: 'alice@example.org' });
    await entry(person, 'block', 'alice@example.org');
    await deliverMail(TO, ham());
    expect(await lastRow()).toMatchObject({ folder: 'spam', spam_reasons: '["block_listed"]' });
  });

  it('mail that answers one of the person’s own mails is not spam (In-Reply-To, or one of the last References)', async () => {
    const person = await bob();
    const other = await createUser('carol@example.com');
    await addMessage(person.id, { folder: 'inbox', message_id: '<mine@example.com>' });
    await addMessage(other.id, { folder: 'inbox', message_id: '<hers@example.com>' });
    await addMessage(person.id, { folder: 'spam', message_id: '<junk@example.org>' });
    await addMessage(person.id, { folder: 'trash', message_id: '<trashed@example.org>' });
    await deliverMail(TO, spam({ headers: [] }));
    expect((await lastRow()).folder).toBe('spam');
    // an answer to somebody else's mail, to a mail they put in Spam or Trash, or to something they never had
    for (const header of [
      'In-Reply-To: <hers@example.com>',
      'In-Reply-To: <junk@example.org>',
      'In-Reply-To: <trashed@example.org>',
      'In-Reply-To: <nothing@example.org>',
      'References: <a@x.example> <hers@example.com>'
    ]) {
      await deliverMail(TO, spam({ headers: [header] }));
      expect((await lastRow()).folder, header).toBe('spam');
    }
    await deliverMail(TO, spam({ headers: ['In-Reply-To: <mine@example.com>'] }));
    expect((await lastRow()).folder).toBe('inbox');
    await deliverMail(TO, spam({ headers: ['References: <a@x.example> <b@x.example>\r\n <mine@example.com>'] }));
    expect((await lastRow()).folder).toBe('inbox');
    // a mail whose id was stored without angle brackets (a sender that wrote it so) is found by the same words
    await addMessage(person.id, { folder: 'inbox', message_id: 'bare-id@example.com' });
    await deliverMail(TO, spam({ headers: ['In-Reply-To: bare-id@example.com'] }));
    expect((await lastRow()).folder).toBe('inbox');
    await deliverMail(TO, spam({ headers: ['In-Reply-To: other-bare@example.com'] }));
    expect((await lastRow()).folder).toBe('spam');
  });

  it('with the switch off nothing is scanned and no list is read: everything goes to the Inbox', async () => {
    const person = await bob();
    await entry(person, 'block', 'example.org');
    await db().update(users).set({ spam_filter: 0 }).where(eq(users.id, person.id));
    await deliverMail(TO, spam());
    await deliverMail(TO, ham({ headers: [CLOUDFLARE_FAIL] }));
    expect((await rows()).map((row) => [row.folder, row.spam_score, row.spam_reasons])).toEqual([
      ['inbox', null, null],
      ['inbox', null, null]
    ]);
  });

  it('mail that arrives before the first Setup has no person, so it is not scanned', async () => {
    await deliverMail('anyone@example.com', spam({ to: 'anyone@example.com' }));
    expect(await lastRow()).toMatchObject({ user_id: null, folder: 'inbox', spam_score: null });
  });
});

describe('what the person is told', () => {
  it('sends no push for spam, and a push for ham', async () => {
    const person = await bob();
    const push = fakePushService();
    const cookie = await signIn(person);
    const device = await subscribeDevice(cookie, 'bob-phone');
    await deliverMail(TO, spam());
    await deliverMail(TO, ham({ from: 'Alice <alice@example.org>' }));
    await waitUntil(() => push.posted.length > 0);
    await settle();
    expect(push.posted).toHaveLength(1);
    expect(await decryptPush(must(push.bodies[0]), device)).toMatchObject({ title: 'Alice' });
  });

  it('tells open tabs with mail.changed (nothing about the mail) for spam, and mail.new for ham', async () => {
    const person = await bob();
    const tab = await openTab(await signIn(person));
    await deliverMail(TO, spam({ from: 'Spammer <spammer@example.org>' }));
    await waitUntil(() => tab.events.some((event) => event.type === 'mail.changed'));
    await settle();
    expect(tab.events.filter((event) => event.type !== 'hello')).toEqual([{ type: 'mail.changed' }]);
    expect(JSON.stringify(tab.events)).not.toContain('spammer');
    await deliverMail(TO, ham());
    await waitUntil(() => tab.events.some((event) => event.type === 'mail.new'));
    tab.close();
  });
});

describe('a failure or a hostile mail never costs the person a mail', () => {
  it('a failure inside the filter delivers the mail to the Inbox, and logs only the class of the error', async () => {
    const person = await bob();
    await db()
      .insert(mailFilters)
      .values({ id: crypto.randomUUID(), user_id: person.id, kind: 'block', value: 'example.org', created_at: 1 });
    const logged = vi.spyOn(console, 'error').mockImplementation(() => 0 as never);
    await env.DB.prepare('ALTER TABLE mail_filters RENAME TO mail_filters_gone').run();
    try {
      const delivery = await deliverMail(TO, spam());
      expect(delivery.rejected).toBeUndefined();
    } finally {
      await env.DB.prepare('ALTER TABLE mail_filters_gone RENAME TO mail_filters').run();
    }
    expect(await lastRow()).toMatchObject({ folder: 'inbox', spam_score: null, spam_reasons: null, enc_fmt: 1 });
    const lines = logged.mock.calls.map((args) => args.map(String).join(' '));
    expect(lines.some((line) => line.includes('Spam filter failed') && line.includes('Error'))).toBe(true);
    // nothing of the mail or of its sender in the log
    expect(lines.join('\n')).not.toMatch(/example\.org|alice|Claim|prize|no such table|mail_filters/i);
  });

  it('a 190 kB hostile HTML mail is judged in a moment and stored', async () => {
    await bob();
    const size = 190_000;
    const shapes = [
      '<a href="'.repeat(size / 9),
      '<div style="display:none">'.repeat(size / 26),
      '<a href="https://x.example/">y</a>'.repeat(size / 33),
      '<'.repeat(size),
      `<p>${'viagra you have won '.repeat(size / 20)}</p>`
    ];
    for (const html of shapes) {
      const started = performance.now();
      const delivery = await deliverMail(TO, mime({ subject: 'Hostile', html }));
      expect(delivery.rejected).toBeUndefined();
      expect(performance.now() - started).toBeLessThan(4000);
    }
    expect(await rows()).toHaveLength(shapes.length);
  });

  it('a hostile Authentication-Results header is read in a moment and the mail is stored', async () => {
    await bob();
    const hostile = `Authentication-Results: mx.cloudflare.net; ${'(a'.repeat(100_000)}; dmarc=pass`;
    const delivery = await deliverMail(TO, ham({ headers: [hostile] }));
    expect(delivery.rejected).toBeUndefined();
    expect((await lastRow()).auth).toBe('spf=none;dkim=none;dmarc=none');
  });

  it('a mail with no From header is still judged (the envelope sender stands in) and stored', async () => {
    await bob();
    const raw = [
      'To: bob@example.com',
      'Subject: x',
      'Message-ID: <x@example.org>',
      'Date: Tue, 17 Nov 2026 09:30:00 +0700',
      '',
      'hello'
    ].join('\r\n');
    expect((await deliverMail(TO, raw)).rejected).toBeUndefined();
    expect(await lastRow()).toMatchObject({ folder: 'inbox', from_address: 'sender@example.org' });
  });
});
