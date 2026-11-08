import { env } from 'cloudflare:workers';
import { createExecutionContext, createScheduledController, waitOnExecutionContext } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fromBase64Url } from '../src/shared/crypto/server';
import { encryptLegacyMail, legacyRowsLeft } from '../src/worker/encrypt-job';
import { attachments, messages, pushKeys, pushSubscriptions, settings, users } from '../src/worker/db/schema';
import worker from '../src/worker/index';
import type { Env } from '../src/worker/types';
import {
  authFor,
  call,
  cookieOf,
  db,
  decryptPush,
  deliverMail,
  enrollTotp,
  fakePushService,
  must,
  newSubscriber,
  openObject,
  openRow,
  rawMail,
  setupKeysWithPair,
  testEnv
} from './helpers';
import type { PushSubscriber } from './helpers';
import {
  attachmentOf,
  dropEverything,
  installLegacySchema,
  legacyAttachmentKey,
  legacyMail,
  legacySessionCookie,
  legacyVapidRow,
  seedLegacyInstall,
  snippetOf,
  upgradeSchema
} from './legacy-install';
import type { LegacyMail } from './legacy-install';

// AC2 / AC46: an installation of the single-user version, with its schema (migrations 0000-0004), its rows and its R2 objects, is upgraded the way
// the guide in docs/deployment.md says: migration 0005, a cron run or two, Setup (the first admin adopts everything), then the encryption job to the end.
// Nothing is lost or duplicated, nothing stays in plaintext (D1 or R2), the admin opens it all with their key, and a crash between any two steps of
// the job leaves the install readable and lets the next run go on.

const PASSWORD = 'a very long administrator password';
const LEGACY_SETTINGS = {
  display_name: 'Edgar Legacy',
  signature: '-- \nEdgar Legacy\nSent from the legacy fixture',
  default_from: 'hi@example.com'
};
const DAY = 86_400_000;
const T0 = Date.parse('2026-10-01T08:00:00Z');

const objectKeys = async (): Promise<string[]> => (await env.BUCKET.list()).objects.map((object) => object.key).toSorted();
const objectBytes = async (key: string): Promise<Uint8Array<ArrayBuffer>> =>
  new Uint8Array(await must(await env.BUCKET.get(key)).arrayBuffer());
const count = async (table: string): Promise<number> =>
  must(await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>()).n;
const rows = () => db().select().from(messages);
/** The calls of a spied console method that are about the VAPID pair (every other line is not what the test asks about). */
const vapidLines = (spy: { mock: { calls: unknown[][] } }): unknown[][] =>
  spy.mock.calls.filter(([first]) => typeof first === 'string' && first.startsWith('[edging-mail] push: the stored VAPID pair'));

async function runCron(overrides: Partial<Env> = {}): Promise<void> {
  const ctx = createExecutionContext();
  worker.scheduled(createScheduledController({ scheduledTime: Date.now(), cron: '* * * * *' }), testEnv(overrides), ctx);
  await waitOnExecutionContext(ctx);
}

/** A bucket that fails its `put` number `failPut` (counted from 1 over the life of this bucket) and/or every `delete`. */
function flaky(plan: { failPut?: number; failDelete?: boolean }): R2Bucket {
  let puts = 0;
  return new Proxy(env.BUCKET, {
    get(target, property) {
      if (property === 'put') {
        return (...args: Parameters<R2Bucket['put']>) => {
          puts += 1;
          return puts === plan.failPut ? Promise.reject(new Error('put boom')) : target.put(...args);
        };
      }
      if (property === 'delete' && plan.failDelete === true) {
        return () => Promise.reject(new Error('delete boom'));
      }
      const value: unknown = Reflect.get(target, property);
      return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    }
  });
}

/** What the single-user version holds: the mail of the fixture (every folder), and 60 more inbox mails so that the job needs several runs. */
function legacyMails(now: number): LegacyMail[] {
  const welcome = legacyMail('welcome', T0, { labels: ['work', 'urgent'] });
  const invoice = legacyMail('invoice', T0 + 5000, { labels: ['billing', 'work'], subject: 'Hóa đơn tháng 10 subj-invoice' });
  invoice.attachments.push(
    attachmentOf('invoice-pdf', 'Hóa đơn.pdf', 'application/pdf', 398),
    attachmentOf('invoice-png', 'logo.png', 'image/png', 70, { cid: '<logo@example.org>', inline: true })
  );
  const specific = [
    legacyMail('archived', T0 - 4000, { folder: 'archive', labels: ['receipts'] }),
    legacyMail('trashed', T0 - 3000, { folder: 'trash' }),
    welcome,
    legacyMail('reply', T0 + 1000, { read: true, inReplyTo: welcome.messageId, threadId: welcome.threadId }),
    legacyMail('newsletter', T0 + 2000, {
      labels: ['newsletter'],
      from: 'news@example.org',
      html: '<p>Bản tin tháng 10 body-newsletter <a href="https://example.org">link</a></p>'
    }),
    invoice,
    legacyMail('starred', T0 + 6000, { starred: true }),
    legacyMail('snoozed-far', T0 + 7000, { folder: 'snoozed', snoozedUntil: now + 300 * DAY }),
    legacyMail('snoozed-due', T0 + 8000, { folder: 'snoozed', snoozedUntil: now - 300_000 }),
    legacyMail('plus-tag', T0 + 9000, { to: 'hi+news@example.com' }),
    legacyMail('other-address', T0 + 10_000, { to: 'info@example.com', read: true }),
    legacyMail('draft', T0 + 11_000, {
      folder: 'drafts',
      read: true,
      from: 'hi@example.com',
      to: 'alice@example.org',
      cc: 'carol@example.org'
    }),
    legacyMail('sent', T0 + 12_000, {
      folder: 'sent',
      read: true,
      from: 'hi@example.com',
      fromName: 'Edgar Legacy',
      to: 'alice@example.org'
    })
  ];
  const bulk = Array.from({ length: 60 }, (_, index) => {
    const mail = legacyMail(`bulk-${index}`, T0 + 20_000 + index * 30_000);
    if (index === 7) {
      mail.attachments.push(attachmentOf('bulk-7', 'big.bin', 'application/octet-stream', 600_000));
    } else if (index % 10 === 9) {
      mail.attachments.push(attachmentOf(`bulk-${index}`, `file-${index}.pdf`, 'application/pdf', 2000));
    }
    return mail;
  });
  return [...specific, ...bulk];
}

interface Deployed {
  mails: LegacyMail[];
  vapidPublicKey: string;
  device: { endpoint: string; p256dh: string; auth: string };
  subscriber: PushSubscriber;
  /** What the Worker sent to the push service (nothing leaves the test: a real service would answer 404 or 410 for the fixture's endpoint and the Worker would drop the device). */
  push: ReturnType<typeof fakePushService>;
}

afterEach(() => {
  vi.restoreAllMocks();
});

/** Runs `body` on a database that is the single-user version's, and puts the full schema back afterwards (the next test file expects it). */
async function onLegacyInstall(body: (deployed: Deployed) => Promise<void>, vapidSecret = env.JWT_SECRET ?? ''): Promise<void> {
  const push = fakePushService();
  try {
    await installLegacySchema();
    const mails = legacyMails(Date.now());
    const subscriber = await newSubscriber();
    const device = { endpoint: 'https://fcm.googleapis.com/fcm/send/legacy-fixture-endpoint-0001', ...subscriber.keys };
    const { vapidPublicKey } = await seedLegacyInstall(mails, LEGACY_SETTINGS, device, vapidSecret);
    await body({ mails, vapidPublicKey, device, subscriber, push });
  } finally {
    await dropEverything();
    await upgradeSchema();
  }
}

/** Setup as the browser does it, then the enrolment the gate asks for; returns the admin's session and keys. */
async function runSetup(email = 'hi@example.com') {
  const { request, keys } = await setupKeysWithPair(email);
  const auth = await authFor(email, PASSWORD);
  const answer = await call('/api/auth/setup', {
    body: { setup_key: env.APP_PASSWORD, email, auth, kdf: 1, aliases: ['info@example.com'], keys: request }
  });
  expect(answer.status).toBe(200);
  const admin = must(await db().select().from(users).where(eq(users.email, email)).get());
  const enrolled = await enrollTotp(cookieOf(answer), { auth });
  return { admin, keys, cookie: enrolled.cookie, user: { keys } };
}

describe('upgrading an installation of the single-user version', () => {
  it('applies 0005 without touching a row, hands everything to the first admin at Setup, and ends the old sessions', async () => {
    await onLegacyInstall(async ({ mails, device }) => {
      const objectsBefore = await objectKeys();
      expect(objectsBefore).toHaveLength(
        mails.filter((mail) => mail.rawKey !== null).length + mails.reduce((total, mail) => total + mail.attachments.length, 0)
      );
      await upgradeSchema();

      // the migration changes the schema only: every row, every object, plaintext as before, nobody owns anything yet
      expect(await count('messages')).toBe(mails.length);
      expect(await count('attachments')).toBe(mails.reduce((total, mail) => total + mail.attachments.length, 0));
      expect(await count('users')).toBe(0);
      expect(await objectKeys()).toEqual(objectsBefore);
      // every old mail arrived by email, and the new column says so (the guide, step 4)
      expect((await rows()).map((entry) => entry.origin)).toEqual(mails.map(() => 'smtp'));
      for (const mail of mails) {
        const row = must((await rows()).find((entry) => entry.id === mail.id));
        expect(row, mail.subject).toMatchObject({
          user_id: null,
          enc_fmt: 0,
          subject: mail.subject,
          snippet: snippetOf(mail.text),
          body_text: mail.text,
          body_html: mail.html,
          folder: mail.folder,
          r2_key: mail.rawKey,
          is_read: mail.read ? 1 : 0,
          is_starred: mail.starred ? 1 : 0
        });
      }
      expect(await count('push_subscriptions')).toBe(1);
      expect((await db().select().from(pushSubscriptions))[0]?.user_id).toBeNull();

      // the single-user cookie is not a session of this version, before and after Setup
      const old = await legacySessionCookie();
      expect((await call('/api/stats', { cookie: old })).status).toBe(401);

      // mail that arrives between the deploy and Setup is held under DATA_KEY without an owner; the cron leaves plaintext alone while nobody has keys
      expect(
        (await deliverMail('hi@example.com', rawMail({ to: 'hi@example.com', subject: 'Arrived in the gap', body: 'gap-body' }))).rejected
      ).toBeUndefined();
      await runCron();
      const gap = must((await rows()).find((row) => row.user_id === null && row.enc_fmt === 1));
      expect(gap).toMatchObject({ wrap_kind: 'server', subject: null, key_id: null });
      expect(await legacyRowsLeft(db())).toBe(mails.length);
      // ... and the due snoozed mail went back to the inbox, unread, in that run
      expect(must((await rows()).find((row) => row.id === mails.find((mail) => mail.subject.startsWith('snoozed-due'))?.id))).toMatchObject(
        {
          folder: 'inbox',
          snoozed_until: null,
          is_read: 0
        }
      );

      const { admin, keys, cookie } = await runSetup();
      expect(admin).toMatchObject({
        role: 'admin',
        email: 'hi@example.com',
        display_name: 'Edgar Legacy',
        signature: LEGACY_SETTINGS.signature
      });
      const left = (await db().select().from(settings)).map((row) => row.key);
      for (const key of ['display_name', 'signature', 'default_from', 'sessions_valid_after']) {
        expect(left, key).not.toContain(key);
      }
      expect((await rows()).every((row) => row.user_id === admin.id)).toBe(true);
      expect((await db().select().from(pushSubscriptions)).map((row) => [row.endpoint, row.user_id])).toEqual([
        [device.endpoint, admin.id]
      ]);
      // the mail of the gap was sealed to the admin's key right after Setup
      expect(await openRow(must((await rows()).find((row) => row.id === gap.id)), { keys })).toMatchObject({
        subject: 'Arrived in the gap'
      });
      expect(must((await rows()).find((row) => row.id === gap.id)).wrap_kind).toBe('user');
      expect((await call('/api/stats', { cookie: old })).status).toBe(401);

      // only the addresses of the account receive mail now: the primary (with a +tag), the alias, nothing else
      for (const to of ['hi@example.com', 'hi+news@example.com', 'info@example.com']) {
        expect((await deliverMail(to, rawMail({ to }))).rejected, to).toBeUndefined();
      }
      expect((await deliverMail('sales@example.com', rawMail({ to: 'sales@example.com' }))).rejected).toBe('Unknown recipient');

      // until the job has run, the admin reads the old mail as it was, through the normal routes
      const invoice = must(mails.find((mail) => mail.subject.startsWith('Hóa đơn')));
      const detail = await call<{ message: { body_text: string; subject: string }; attachments: { id: string }[] }>(
        `/api/messages/${invoice.id}`,
        { cookie }
      );
      expect(detail.status).toBe(200);
      expect(detail.json.message).toMatchObject({ subject: invoice.subject, body_text: invoice.text });
      expect(detail.json.attachments).toHaveLength(2);
      const first = must(
        await db()
          .select()
          .from(attachments)
          .where(eq(attachments.message_id, invoice.id))
          .orderBy(attachments.created_at, attachments.id)
          .limit(1)
          .get()
      );
      const original = must(invoice.attachments.find((file) => file.id === first.id));
      const download = await call(`/api/attachments/${first.id}`, { cookie });
      expect(new Uint8Array(await download.response.arrayBuffer())).toEqual(original.bytes);
      const raw = await call(`/api/raw/${invoice.id}`, { cookie });
      expect(raw.text).toBe(invoice.raw);
      expect((await call(`/api/drafts/${must(mails.find((mail) => mail.folder === 'drafts')).id}`, { cookie })).json).toMatchObject({
        draft: { enc_fmt: 0, subject: expect.stringContaining('draft') as string }
      });
    });
  });

  it('encrypts every row and object, resumes after a crash between any two steps, and the admin opens it all', async () => {
    await onLegacyInstall(async ({ mails }) => {
      await upgradeSchema();
      await runCron();
      const { admin, keys, cookie, user } = await runSetup();
      const legacyObjects = (await objectKeys()).filter((key) => !key.startsWith('em1/'));
      expect(legacyObjects).toHaveLength(
        mails.filter((mail) => mail.rawKey !== null).length + mails.reduce((total, mail) => total + mail.attachments.length, 0)
      );
      const plain = await legacyRowsLeft(db());
      expect(plain).toBe(mails.length);

      // two runs of ten rows, then the isolate dies (nothing more runs): the rest is plaintext and untouched, the done rows are EM1 with their old objects gone
      const ten = { ENCRYPT_CHUNK_ROWS: '10' };
      expect(await encryptLegacyMail(testEnv(ten))).toEqual({ converted: 10, remaining: plain - 10 });
      expect(await encryptLegacyMail(testEnv(ten))).toEqual({ converted: 10, remaining: plain - 20 });
      const byId = new Map(mails.map((mail) => [mail.id, mail]));
      const present = await objectKeys();
      for (const row of await rows()) {
        const mail = must(byId.get(row.id));
        if (row.enc_fmt === 0) {
          expect(row.subject, 'a row that is still plaintext is whole').toBe(mail.subject);
          if (mail.rawKey !== null) {
            expect(present).toContain(mail.rawKey);
          }
        } else {
          expect(row.subject).toBeNull();
          expect(present).not.toContain(mail.rawKey);
        }
      }

      // a crash IN a row (the second object of the next run fails: the 600 kB attachment): that row stays plaintext, the object it did write is removed, the others go on
      const crashed = must(mails.find((mail) => mail.attachments.some((file) => file.bytes.length === 600_000)));
      const interrupted = await encryptLegacyMail(testEnv({ ...ten, BUCKET: flaky({ failPut: 2 }) }));
      expect(interrupted.converted).toBe(9);
      expect(must((await rows()).find((row) => row.id === crashed.id))).toMatchObject({ enc_fmt: 0, subject: crashed.subject });
      expect((await objectKeys()).filter((key) => key.includes(crashed.id))).toEqual(
        [must(crashed.rawKey), legacyAttachmentKey(crashed.id, must(crashed.attachments.at(0)))].toSorted()
      );

      // a run that died and never let go of its lease holds the others off for at most four minutes, then the next run goes on
      await db()
        .update(settings)
        .set({ value: String(Date.now() + 120_000) })
        .where(eq(settings.key, 'encrypt_lease'));
      expect((await encryptLegacyMail(testEnv(ten))).converted).toBe(0);
      await db()
        .update(settings)
        .set({ value: String(Date.now() - 1) })
        .where(eq(settings.key, 'encrypt_lease'));

      // a crash AFTER a row was written and flipped, before its old objects were deleted (here: every delete fails): rows are converted, their
      // plaintext objects stay for now
      const oldBefore = (await objectKeys()).filter((key) => !key.startsWith('em1/')).length;
      const failedDeletes = await encryptLegacyMail(testEnv({ ...ten, BUCKET: flaky({ failDelete: true }) }));
      expect(failedDeletes.converted).toBeGreaterThan(0);
      expect((await objectKeys()).filter((key) => !key.startsWith('em1/'))).toHaveLength(oldBefore);

      // the cron goes on until nothing is left (and once more, for the clean-up of what a crash left behind)
      for (let run = 0; run < 10 && (await legacyRowsLeft(db())) > 0; run += 1) {
        await runCron();
      }
      await runCron();
      await runCron();
      expect(await legacyRowsLeft(db())).toBe(0);

      // nothing lost, nothing duplicated
      const stored = await rows();
      expect(stored).toHaveLength(mails.length);
      expect(new Set(stored.map((row) => row.id)).size).toBe(stored.length);
      expect(mails.every((mail) => stored.some((row) => row.id === mail.id))).toBe(true);
      expect(await count('attachments')).toBe(mails.reduce((total, mail) => total + mail.attachments.length, 0));

      // no plaintext anywhere: the rows are EM1 sealed to the admin, and R2 holds EM1 objects only, one per raw mail and per attachment
      for (const row of stored) {
        expect(row, row.id).toMatchObject({
          enc_fmt: 1,
          wrap_kind: 'user',
          key_id: keys.keyId,
          subject: null,
          snippet: null,
          body_text: null,
          body_html: null,
          user_id: admin.id
        });
      }
      const objects = await objectKeys();
      expect(objects.filter((key) => !key.startsWith('em1/'))).toEqual([]);
      expect(objects).toHaveLength(
        mails.filter((mail) => mail.rawKey !== null).length + mails.reduce((total, mail) => total + mail.attachments.length, 0)
      );
      const scan = JSON.stringify([stored, await db().select().from(attachments)]);
      for (const marker of ['subj-', 'body-', 'att-', 'attc-', 'Hóa đơn']) {
        expect(scan, `D1 has no ${marker}`).not.toContain(marker);
        for (const key of objects) {
          expect(new TextDecoder().decode(await objectBytes(key)), `${key} has no ${marker}`).not.toContain(marker);
        }
      }

      // the admin opens everything with their key: text, html, the whole raw mail, every attachment and its description; nothing changed besides the content
      for (const mail of mails) {
        const row = must(stored.find((entry) => entry.id === mail.id));
        expect(await openRow(row, user), mail.subject).toEqual({
          subject: mail.subject,
          snippet: snippetOf(mail.text),
          text: mail.text,
          html: mail.html
        });
        expect(row.r2_key).toBe(mail.raw === null ? null : `em1/${admin.id}/${mail.id}/raw`);
        if (mail.raw !== null) {
          expect(new TextDecoder().decode(await openObject(row, user, 'raw', await objectBytes(must(row.r2_key))))).toBe(mail.raw);
        }
        const files = await db().select().from(attachments).where(eq(attachments.message_id, mail.id));
        expect(files).toHaveLength(mail.attachments.length);
        for (const file of files) {
          const original = must(mail.attachments.find((entry) => entry.id === file.id));
          expect(file).toMatchObject({
            filename: '',
            mime_type: '',
            content_id: null,
            r2_key: `em1/${admin.id}/${mail.id}/att/${file.id}`
          });
          expect(await openObject(row, user, `att/${file.id}`, await objectBytes(file.r2_key))).toEqual(original.bytes);
          expect(
            JSON.parse(new TextDecoder().decode(await openObject(row, user, `att-meta/${file.id}`, fromBase64Url(must(file.meta_blob)))))
          ).toEqual({
            filename: original.filename,
            mime_type: original.mime,
            content_id: original.cid
          });
        }
        // folder, labels, flags, threading and dates are as the old version had them (the due snoozed mail was released by the cron)
        const released = mail.snoozedUntil !== null && mail.snoozedUntil < Date.now();
        expect(row, mail.subject).toMatchObject({
          folder: released ? 'inbox' : mail.folder,
          labels: JSON.stringify(mail.labels),
          is_read: released ? 0 : mail.read ? 1 : 0,
          is_starred: mail.starred ? 1 : 0,
          thread_id: mail.threadId,
          message_id: mail.messageId,
          in_reply_to: mail.inReplyTo,
          created_at: mail.createdAt
        });
      }

      // the app says so too: no plaintext row left, the draft is there for the admin, and the counts of the folders are the old ones
      const health = await call<{ health: { plaintext_rows: number; pending_rows: number } }>('/api/admin/health', { cookie });
      expect(health.json.health).toMatchObject({ plaintext_rows: 0, pending_rows: 0 });
      const draft = must(mails.find((mail) => mail.folder === 'drafts'));
      expect((await call(`/api/drafts/${draft.id}`, { cookie })).json).toMatchObject({
        draft: { id: draft.id, enc_fmt: 1, wrap_kind: 'user', key_id: keys.keyId }
      });
      const stats = await call<{ stats: Record<string, { total: number; unread: number }> }>('/api/stats', { cookie });
      const inbox = mails.filter((mail) => mail.folder === 'inbox' || (mail.snoozedUntil !== null && mail.snoozedUntil < Date.now()));
      expect(stats.json.stats.inbox.total).toBe(inbox.length);
      expect(stats.json.stats.inbox.unread).toBe(inbox.filter((mail) => !mail.read).length);
      expect(stats.json.stats).toMatchObject({
        archive: { total: 1 },
        trash: { total: 1 },
        sent: { total: 1 },
        drafts: { total: 1 },
        snoozed: { total: 1 },
        starred: { total: 1 }
      });
    });
  });

  it('keeps the devices and the VAPID key of the old install working: the pair is read once with JWT_SECRET and sealed under DATA_KEY', async () => {
    await onLegacyInstall(async ({ vapidPublicKey, device, subscriber, push }) => {
      await upgradeSchema();
      const before = must(await db().select().from(pushKeys).where(eq(pushKeys.id, 1)).get());
      const { admin, cookie } = await runSetup();
      // the first thing push does after the upgrade: read the key the devices were made for
      const answer = await call<{ publicKey: string }>('/api/push/public-key', { cookie });
      expect(answer.status).toBe(200);
      expect(answer.json.publicKey).toBe(vapidPublicKey);
      expect((await db().select().from(pushSubscriptions)).map((row) => [row.endpoint, row.user_id])).toEqual([
        [device.endpoint, admin.id]
      ]);
      const stored = must(await db().select().from(pushKeys).where(eq(pushKeys.id, 1)).get());
      expect(stored.public_key).toBe(vapidPublicKey);
      expect(stored.private_key_sealed, 'sealed under DATA_KEY now').not.toBe(before.private_key_sealed);
      expect((await call<{ publicKey: string }>('/api/push/public-key', { cookie })).json.publicKey).toBe(vapidPublicKey);
      // and the old device really gets a notification, readable with its own keys
      // what Setup and the gap mail sent to the device is not the question here
      push.posted.splice(0);
      push.bodies.splice(0);
      expect((await call('/api/push/test', { cookie, body: {} })).status).toBe(200);
      expect(push.posted).toEqual([device.endpoint]);
      expect(await decryptPush(must(push.bodies.at(0)), subscriber)).toMatchObject({ tag: 'test' });
    });
  });

  it('answers a legacy VAPID row nobody can open (sealed under another JWT_SECRET) like any unreadable pair: a new pair, the old devices dropped', async () => {
    await onLegacyInstall(async ({ vapidPublicKey }) => {
      await upgradeSchema();
      const devices = (await db().select().from(pushSubscriptions)).length;
      expect(devices).toBeGreaterThan(0);
      const warn = vi.spyOn(console, 'warn').mockImplementation(vi.fn());
      const { cookie } = await runSetup();
      const answer = await call<{ publicKey: string }>('/api/push/public-key', { cookie });
      expect(answer.status).toBe(200);
      expect(answer.json.publicKey).not.toBe(vapidPublicKey);
      expect(await db().select().from(pushSubscriptions)).toEqual([]);
      // LG-3: one line, no value of any key, says what happened and how many devices went
      expect(vapidLines(warn)).toEqual([
        [`[edging-mail] push: the stored VAPID pair could not be opened; a new pair was made and ${devices} device(s) removed`]
      ]);
    }, 'a secret that is no longer the JWT_SECRET of this deployment');
  });

  it('rotates the pair when the row of push_keys is deleted after the upgrade, as the guide says: a new pair, no device, no log line', async () => {
    await onLegacyInstall(async ({ vapidPublicKey }) => {
      await upgradeSchema();
      const { cookie } = await runSetup();
      expect((await call<{ publicKey: string }>('/api/push/public-key', { cookie })).json.publicKey).toBe(vapidPublicKey);
      expect(await db().select().from(pushSubscriptions)).not.toEqual([]);
      const warn = vi.spyOn(console, 'warn').mockImplementation(vi.fn());
      await env.DB.prepare('DELETE FROM push_keys WHERE id = 1').run();
      const answer = await call<{ publicKey: string }>('/api/push/public-key', { cookie });
      expect(answer.status).toBe(200);
      expect(answer.json.publicKey).not.toBe(vapidPublicKey);
      expect(await db().select().from(pushSubscriptions)).toEqual([]);
      expect(vapidLines(warn)).toEqual([]);
    });
  });

  it('does not keep a legacy pair whose private half does not belong to its public key: it is replaced like an unreadable one (LG-5)', async () => {
    await onLegacyInstall(async ({ vapidPublicKey }) => {
      await upgradeSchema();
      const devices = (await db().select().from(pushSubscriptions)).length;
      // sealed the old way under the right JWT_SECRET, so it opens, but the scalar is another pair's
      const row = await legacyVapidRow(env.JWT_SECRET ?? '', true);
      await env.DB.prepare('UPDATE push_keys SET public_key = ?1, private_key_sealed = ?2 WHERE id = 1')
        .bind(row.public_key, row.private_key_sealed)
        .run();
      const warn = vi.spyOn(console, 'warn').mockImplementation(vi.fn());
      const { cookie } = await runSetup();
      const answer = await call<{ publicKey: string }>('/api/push/public-key', { cookie });
      expect(answer.status).toBe(200);
      expect([answer.json.publicKey === row.public_key, answer.json.publicKey === vapidPublicKey]).toEqual([false, false]);
      expect(await db().select().from(pushSubscriptions)).toEqual([]);
      expect(vapidLines(warn)).toHaveLength(1);
      expect(String(vapidLines(warn)[0]?.[0])).toContain(`${devices} device(s) removed`);
    });
  });
});
