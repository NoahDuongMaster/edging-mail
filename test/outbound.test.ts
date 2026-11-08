import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { messages } from '../src/worker/db/schema';
import { call, createUser, db, draftBody, openRow, signIn } from './helpers';

// AC17: the From address of an outgoing mail is always the signed-in user's primary address; nothing else can be chosen.

interface SentMail {
  from: string | { name: string; email: string };
  to: string[];
  subject: string;
}

function mailBinding(): { sent: SentMail[]; binding: SendEmail } {
  const sent: SentMail[] = [];
  const binding = {
    send: (builder: SentMail) => {
      sent.push(builder);
      return Promise.resolve({ messageId: `<out-${sent.length}@example.com>` });
    }
  } as unknown as SendEmail;
  return { sent, binding };
}

const storedMail = () => db().select().from(messages);

describe('outbound From is the signed-in user (AC17)', () => {
  it('sends from the primary address with the display name, and stores the mail for its sender', async () => {
    const alice = await createUser('alice@example.com', { display_name: 'Alice A' });
    const { sent, binding } = mailBinding();
    const answer = await call<{ message: { id: string; from_address: string; user_id: string; folder: string } }>('/api/messages/send', {
      cookie: await signIn(alice),
      env: { SEND_EMAIL: binding },
      body: { to: 'friend@example.org', subject: 'Hello', text: 'Hi there' }
    });
    expect(answer.status).toBe(200);
    expect(sent).toHaveLength(1);
    expect(sent[0].from).toEqual({ name: 'Alice A', email: 'alice@example.com' });
    expect(answer.json.message).toMatchObject({ from_address: 'alice@example.com', user_id: alice.id, folder: 'sent' });
    const [row] = await storedMail();
    // Sealed to the sender's own key: nothing readable in the row
    expect(row).toMatchObject({
      user_id: alice.id,
      from_address: 'alice@example.com',
      folder: 'sent',
      enc_fmt: 1,
      wrap_kind: 'user',
      subject: null,
      body_text: null
    });
    expect(row.key_id).toBe(alice.keys?.keyId);
    expect(await openRow(row, alice)).toMatchObject({ subject: 'Hello', text: 'Hi there' });
  });

  it('sends the bare address when the user has no display name, and accepts their own address in other letter case', async () => {
    const alice = await createUser('alice@example.com');
    const { sent, binding } = mailBinding();
    const answer = await call('/api/messages/send', {
      cookie: await signIn(alice),
      env: { SEND_EMAIL: binding },
      body: { from: ' Alice@Example.COM ', to: ['friend@example.org'], subject: 'Hello', text: 'x' }
    });
    expect(answer.status).toBe(200);
    expect(sent[0].from).toBe('alice@example.com');
  });

  it('refuses any other From address, even an alias of the same person, and sends and stores nothing', async () => {
    const alice = await createUser('alice@example.com', { aliases: ['sales@example.com'] });
    const bob = await createUser('bob@example.com');
    const { sent, binding } = mailBinding();
    const cookie = await signIn(alice);
    for (const from of [bob.email, 'sales@example.com', 'ceo@example.org', 'Bob <bob@example.com>']) {
      const answer = await call('/api/messages/send', {
        cookie,
        env: { SEND_EMAIL: binding },
        body: { from, to: 'friend@example.org', subject: 'Hello', text: 'x' }
      });
      expect(answer.status, from).toBe(403);
      expect(answer.json, from).toMatchObject({ success: false, code: 'from_not_allowed' });
    }
    expect(sent).toHaveLength(0);
    expect(await storedMail()).toHaveLength(0);
  });

  it('uses the From of the user who is signed in, each with their own name', async () => {
    const alice = await createUser('alice@example.com', { display_name: 'Alice' });
    const bob = await createUser('bob@example.com', { display_name: 'Bob' });
    const { sent, binding } = mailBinding();
    await call('/api/messages/send', {
      cookie: await signIn(bob),
      env: { SEND_EMAIL: binding },
      body: { to: 'friend@example.org', subject: 'From Bob', text: 'x' }
    });
    await call('/api/messages/send', {
      cookie: await signIn(alice),
      env: { SEND_EMAIL: binding },
      body: { to: 'friend@example.org', subject: 'From Alice', text: 'x' }
    });
    expect(sent.map((mail) => mail.from)).toEqual([
      { name: 'Bob', email: 'bob@example.com' },
      { name: 'Alice', email: 'alice@example.com' }
    ]);
    const bobMail = await db().select().from(messages).where(eq(messages.user_id, bob.id));
    expect(await Promise.all(bobMail.map(async (row) => (await openRow(row, bob)).subject))).toEqual(['From Bob']);
  });

  it("deletes the sender's own draft after a successful send, and keeps it when sending fails", async () => {
    const alice = await createUser('alice@example.com');
    const cookie = await signIn(alice);
    const draftId = crypto.randomUUID();
    expect(
      (
        await call(`/api/drafts/${draftId}`, {
          cookie,
          method: 'PUT',
          body: await draftBody(alice, draftId, { to: ['friend@example.org'] })
        })
      ).status
    ).toBe(200);
    const unconfigured = await call('/api/messages/send', {
      cookie,
      env: { SEND_EMAIL: undefined },
      body: { to: 'friend@example.org', subject: 'Draft', text: 'x', draft_id: draftId }
    });
    expect(unconfigured.status).toBeGreaterThanOrEqual(400);
    expect((await storedMail()).map((row) => row.folder)).toEqual(['drafts']);

    const { binding } = mailBinding();
    const sent = await call('/api/messages/send', {
      cookie,
      env: { SEND_EMAIL: binding },
      body: { to: 'friend@example.org', subject: 'Draft', text: 'x', draft_id: draftId }
    });
    expect(sent.status).toBe(200);
    expect((await storedMail()).map((row) => row.folder)).toEqual(['sent']);
  });
});
