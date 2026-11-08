import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { domains, messages, users } from '../src/worker/db/schema';
import { lookupKeys } from '../src/worker/auth/lookup';
import { withFromHosted } from '../src/worker/mail/view';
import { call, createUser, db, deliverMail, must, rawMail, signIn } from './helpers';
import { internalBody } from './internal-helpers';

// crypto-review.md section 22: PX-10 (the key lookup and a disabled account), PX-11 (a disabled account still receives mail) and PX-12 (where a mail
// came from: `origin` and `from_hosted`).

describe('the key lookup and a disabled account (PX-10, PX-11)', () => {
  it('answers a disabled person like an address nobody owns: no key, not internal; an alias too; an active person as before', async () => {
    const asker = await createUser('asker@example.com');
    const gone = await createUser('gone@example.com', { status: 'disabled', aliases: ['gone-alias@example.com'] });
    const active = await createUser('active@example.com');
    const cookie = await signIn(asker);
    const answer = await call<{ keys: { address: string; internal: boolean; public_key?: string; key_id?: string }[] }>(
      '/api/keys/lookup',
      {
        cookie,
        body: { addresses: [gone.email, 'gone-alias@example.com', active.email, 'nobody@example.com'] }
      }
    );
    expect(answer.status).toBe(200);
    expect(answer.json.keys).toEqual([
      { address: 'gone@example.com', internal: false },
      { address: 'gone-alias@example.com', internal: false },
      { address: 'active@example.com', internal: true, public_key: must(active.keys).spki, key_id: must(active.keys).keyId },
      { address: 'nobody@example.com', internal: false }
    ]);
    // the person is enabled again: the key is offered again
    await db().update(users).set({ status: 'active' }).where(eq(users.id, gone.id));
    expect((await lookupKeys(db(), ['gone@example.com']))[0]).toMatchObject({ internal: true, key_id: must(gone.keys).keyId });
  });

  it('still delivers mail to a disabled account: the row lands, sealed to its key, and waits for the person', async () => {
    const gone = await createUser('gone@example.com', { status: 'disabled' });
    const delivery = await deliverMail(
      'gone@example.com',
      rawMail({ from: 'sender@example.org', to: 'gone@example.com', subject: 'While you were away' })
    );
    expect(delivery.rejected).toBeUndefined();
    const row = must((await db().select().from(messages)).find((entry) => entry.user_id === gone.id));
    expect(row).toMatchObject({ folder: 'inbox', enc_fmt: 1, wrap_kind: 'user', key_id: must(gone.keys).keyId });
  });
});

const list = (cookie: string, folder = 'inbox') =>
  call<{ messages: { id: string; origin: string; from_hosted: boolean; from_address: string }[] }>(`/api/messages?folder=${folder}`, {
    cookie
  });

describe('where a mail came from (PX-12)', () => {
  it('marks a mail that arrived by email `smtp` and one written in the app `internal`, in the list and in the detail', async () => {
    const alice = await createUser('alice@example.com');
    const bob = await createUser('bob@example.com');
    const bobCookie = await signIn(bob);
    await deliverMail('bob@example.com', rawMail({ from: 'alice@example.com', to: 'bob@example.com', subject: 'by email' }));
    const sent = await call('/api/messages/internal', {
      cookie: await signIn(alice),
      body: await internalBody(alice, { to: [bob] }, { subject: 'in the app', text: 'hello' })
    });
    expect(sent.status).toBe(200);
    const inbox = (await list(bobCookie)).json.messages;
    expect(inbox).toHaveLength(2);
    const byEmail = must(inbox.find((entry) => (entry as { is_e2e?: number }).is_e2e === 0));
    const inApp = must(inbox.find((entry) => (entry as { is_e2e?: number }).is_e2e === 1));
    expect([byEmail.origin, inApp.origin]).toEqual(['smtp', 'internal']);
    const detail = await call<{ message: { origin: string; from_hosted: boolean } }>(`/api/messages/${byEmail.id}`, { cookie: bobCookie });
    expect(detail.json.message).toMatchObject({ origin: 'smtp', from_hosted: true });
    // the sender's own copy came the app's way too
    const mine = await list(await signIn(alice), 'sent');
    expect(mine.json.messages.map((entry) => entry.origin)).toEqual(['internal']);
  });

  it('says `from_hosted` for a From address on a domain of this deployment, read when the mail is read', async () => {
    const bob = await createUser('bob@example.com');
    const cookie = await signIn(bob);
    await deliverMail(
      'bob@example.com',
      rawMail({ from: 'ceo@example.com', to: 'bob@example.com', subject: 'pay this invoice', messageId: '<a1@evil.test>' })
    );
    await deliverMail(
      'bob@example.com',
      rawMail({ from: 'someone@evil.test', to: 'bob@example.com', subject: 'hello', messageId: '<a2@evil.test>' })
    );
    const flags = async (): Promise<[string, boolean][]> =>
      (await list(cookie)).json.messages
        .map((entry): [string, boolean] => [entry.from_address, entry.from_hosted])
        .toSorted((a, b) => a[0].localeCompare(b[0]));
    expect(await flags()).toEqual([
      ['ceo@example.com', true],
      ['someone@evil.test', false]
    ]);
    // another domain becomes hosted, and the first one stops: the flags follow at once
    await db().insert(domains).values({ id: crypto.randomUUID(), name: 'evil.test', created_at: Date.now() });
    await db().delete(domains).where(eq(domains.name, 'example.com'));
    expect(await flags()).toEqual([
      ['ceo@example.com', false],
      ['someone@evil.test', true]
    ]);
  });

  it('takes the domain after the LAST @, in any case, and says false for anything that is not an address', async () => {
    await createUser('bob@example.com');
    const rows = [
      'a@example.com',
      'A@EXAMPLE.COM',
      ' a@example.com ',
      'x@evil.test@example.com',
      'a@evil.test@other.test',
      'a@sub.example.com',
      'example.com',
      '',
      '@'
    ].map((from_address) => ({ from_address }));
    expect((await withFromHosted(db(), rows)).map((row) => row.from_hosted)).toEqual([
      true,
      true,
      true,
      true,
      false,
      false,
      false,
      false,
      false
    ]);
    expect(await withFromHosted(db(), [])).toEqual([]);
  });

  it('is decided by the Worker: a mail cannot say where it came from, and a sender cannot set `origin`', async () => {
    const alice = await createUser('alice@example.com');
    const bob = await createUser('bob@example.com');
    // a header of the mail naming itself internal changes nothing
    await deliverMail(
      'bob@example.com',
      rawMail({ from: 'alice@example.com', to: 'bob@example.com', subject: 'x' }).replace(
        '\r\n\r\n',
        '\r\nX-Origin: internal\r\nOrigin: internal\r\n\r\n'
      )
    );
    // and the internal route refuses an `origin` field like any unknown one
    const body = await internalBody(alice, { to: [bob] }, { subject: 'y', text: 'z' }, { origin: 'internal' });
    const refused = await call('/api/messages/internal', { cookie: await signIn(alice), body });
    expect([refused.status, refused.json.code]).toEqual([400, 'invalid_body']);
    expect((await db().select().from(messages)).map((row) => row.origin)).toEqual(['smtp']);
  });
});
