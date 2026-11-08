import { and, asc, count, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { deleteBlobs, getBlob, putBlob } from './content';
import { batchChanges, getDb } from './db';
import type { Db } from './db';
import { attachments, messages, settings, users } from './db/schema';
import { userRecipient } from './mail/recipient';
import { sealMessage } from './mail/seal';
import type { AttachmentContent } from './mail/seal';
import type { Env } from './types';
import { errorClass } from './utils';

// The encryption job (D10): turns the plaintext mail of an installation that existed before encryption (enc_fmt 0) into EM1, in small
// chunks, from the cron. Per row, in this order (a crash at any point leaves the row fully plaintext, to be retried, or fully encrypted):
//   1. read the legacy R2 objects, seal everything with a fresh content key for the OWNER's key (only owners who have one are visited);
//   2. write the new objects (`em1/<owner>/<row>/...`, never a legacy key, so nothing is overwritten);
//   3. ONE batch: the attachment rows first, the message row last, every statement guarded by `enc_fmt = 0` of that row, so a second
//      writer changes nothing; the message update's `changes` says who won;
//   4. only the winner deletes the legacy objects. A loser whose row is gone deletes the objects it wrote.
// A single-flight lease row keeps two overlapping cron runs from encrypting the same row.

const LEASE_KEY = 'encrypt_lease';
// Set (to '1') once a pass over the old R2 layout found nothing left; until then every run of the job that finds no plaintext row looks again.
const SWEPT_KEY = 'legacy_objects_swept';
// The prefixes the single-user version wrote under: raw mail, sent mail, attachments. This version writes `em1/` only, so every object under one of
// them is an old, plaintext copy.
const LEGACY_PREFIXES = ['raw/', 'sent/', 'attachments/'];
const SWEEP_LIMIT = 1000;
const LEASE_MS = 4 * 60_000;
// A run stops starting new rows this long before its lease would end.
const LEASE_MARGIN_MS = 30_000;
const DEFAULT_CHUNK = 25;
const MAX_CHUNK = 500;

/** Rows per run: the ENCRYPT_CHUNK_ROWS variable (1..500), default 25. A test sets 1 to interrupt the job between rows. */
export function chunkSize(env: Env): number {
  const parsed = Number.parseInt(env.ENCRYPT_CHUNK_ROWS ?? '', 10);
  return Number.isNaN(parsed) ? DEFAULT_CHUNK : Math.min(MAX_CHUNK, Math.max(1, parsed));
}

/** Plaintext rows still waiting (all owners, including those who have no key yet). */
export async function legacyRowsLeft(db: Db): Promise<number> {
  const row = await db.select({ total: count() }).from(messages).where(eq(messages.enc_fmt, 0)).get();
  return row?.total ?? 0;
}

async function acquireLease(db: Db, now: number): Promise<boolean> {
  const taken = await db
    .insert(settings)
    .values({ key: LEASE_KEY, value: String(now + LEASE_MS), updated_at: now })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value: String(now + LEASE_MS), updated_at: now },
      setWhere: sql`CAST(${settings.value} AS INTEGER) < ${now}`
    })
    .returning({ key: settings.key });
  return taken.length === 1;
}

const releaseLease = (db: Db) => db.update(settings).set({ value: '0' }).where(eq(settings.key, LEASE_KEY));

async function readObject(env: Env, key: string | null): Promise<Uint8Array<ArrayBuffer> | null> {
  if (key === null || key === '') {
    return null;
  }
  const object = await getBlob(env, key);
  return object === null ? null : new Uint8Array(await object.arrayBuffer());
}

type LegacyRow = typeof messages.$inferSelect & { owner_key: string | null };

/** Converts one row. Returns true when this call converted it. Never leaves a half-written row: failures before the batch change nothing. */
async function convert(env: Env, db: Db, row: LegacyRow): Promise<boolean> {
  const recipient = await userRecipient(row.owner_key);
  if (recipient === undefined || row.user_id === null) {
    return false;
  }
  const legacyAttachments = await db
    .select()
    .from(attachments)
    .where(eq(attachments.message_id, row.id))
    .orderBy(asc(attachments.created_at));
  const contents: AttachmentContent[] = [];
  for (const attachment of legacyAttachments) {
    // An object that is already gone is gone: its attachment is kept with no content rather than blocking the whole mail for ever.
    contents.push({
      id: attachment.id,
      filename: attachment.filename,
      mime_type: attachment.mime_type,
      content_id: attachment.content_id,
      bytes: (await readObject(env, attachment.r2_key)) ?? new Uint8Array(0)
    });
  }
  const raw = await readObject(env, row.r2_key);
  const sealed = await sealMessage(
    recipient,
    row.user_id,
    row.id,
    { subject: row.subject, snippet: row.snippet, text: row.body_text, html: row.body_html },
    raw,
    contents
  );

  const written: string[] = [];
  try {
    for (const object of sealed.objects) {
      await putBlob(env, object.key, object.body);
      written.push(object.key);
    }
  } catch (error) {
    await deleteBlobs(env, written);
    throw error;
  }

  // Every statement applies only while the row is still plaintext; the message row is last and its `changes` decides the winner.
  const stillPlain = sql`EXISTS (SELECT 1 FROM ${messages} WHERE ${messages.id} = ${row.id} AND ${messages.enc_fmt} = 0)`;
  const changes = await batchChanges(db, [
    ...sealed.attachments.map((attachment) =>
      db
        .update(attachments)
        .set({ filename: '', mime_type: '', content_id: null, meta_blob: attachment.meta_blob, r2_key: attachment.r2_key })
        .where(and(eq(attachments.id, attachment.id), stillPlain))
    ),
    db
      .update(messages)
      .set(sealed.columns)
      .where(and(eq(messages.id, row.id), eq(messages.enc_fmt, 0)))
  ]);

  if (changes.at(-1) === 1) {
    await deleteBlobs(
      env,
      [row.r2_key ?? '', ...legacyAttachments.map((attachment) => attachment.r2_key)].filter((key) => key !== '')
    );
    return true;
  }
  // Somebody else converted the row (their objects live under the same keys), or the row was deleted meanwhile (then ours are orphans).
  const current = await db.select({ enc_fmt: messages.enc_fmt }).from(messages).where(eq(messages.id, row.id)).get();
  if (current === undefined) {
    await deleteBlobs(env, written);
  }
  return false;
}

/** Which of these R2 keys a message or an attachment row still points at (in chunks: D1 binds at most 100 values per statement). */
async function referencedKeys(db: Db, keys: string[]): Promise<Set<string>> {
  const used = new Set<string>();
  for (let start = 0; start < keys.length; start += 90) {
    const chunk = keys.slice(start, start + 90);
    for (const row of await db.select({ key: messages.r2_key }).from(messages).where(inArray(messages.r2_key, chunk))) {
      used.add(row.key ?? '');
    }
    for (const row of await db.select({ key: attachments.r2_key }).from(attachments).where(inArray(attachments.r2_key, chunk))) {
      used.add(row.key);
    }
  }
  return used;
}

/**
 * What is left of the old layout once no plaintext row is. A row is flipped before its old objects are deleted, so a crash (or a failing delete) in
 * between leaves a plaintext copy of an already converted mail that nothing refers to; the same goes for copies of mail that was deleted long ago.
 * Only called when no plaintext row is left, and under the lease; an object a row still points at is never touched. Up to 1000 objects per prefix
 * per run; the job is finished (and stops looking) when a pass finds no object that nothing points at.
 */
async function sweepLegacyObjects(env: Env, db: Db): Promise<void> {
  const done = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, SWEPT_KEY)).get();
  if (done?.value === '1') {
    return;
  }
  let found = 0;
  for (const prefix of LEGACY_PREFIXES) {
    const listing = await env.BUCKET.list({ prefix, limit: SWEEP_LIMIT });
    const keys = listing.objects.map((object) => object.key);
    const used = await referencedKeys(db, keys);
    const orphans = keys.filter((key) => !used.has(key));
    found += orphans.length;
    await deleteBlobs(env, orphans);
  }
  if (found === 0) {
    const now = Date.now();
    await db
      .insert(settings)
      .values({ key: SWEPT_KEY, value: '1', updated_at: now })
      .onConflictDoUpdate({ target: settings.key, set: { value: '1', updated_at: now } });
  } else {
    console.error(`[edging-mail] Removed ${found} old plaintext object(s) that a conversion had left behind`);
  }
}

/** One cron run: up to ENCRYPT_CHUNK_ROWS rows. Never throws. */
export async function encryptLegacyMail(env: Env): Promise<{ converted: number; remaining: number }> {
  const db = getDb(env.DB);
  const now = Date.now();
  let converted = 0;
  try {
    if (!(await acquireLease(db, now))) {
      return { converted, remaining: await legacyRowsLeft(db) };
    }
    try {
      // Only owners who have a key; mail of an owner without one waits (and is also handled by the pending path when it arrives new).
      const rows = await db
        .select({ message: messages, owner_key: users.public_key })
        .from(messages)
        .innerJoin(users, eq(users.id, messages.user_id))
        .where(and(eq(messages.enc_fmt, 0), isNotNull(users.public_key)))
        .orderBy(sql`messages.rowid`)
        .limit(chunkSize(env));
      for (const { message, owner_key } of rows) {
        if (Date.now() > now + LEASE_MS - LEASE_MARGIN_MS) {
          break;
        }
        try {
          if (await convert(env, db, { ...message, owner_key })) {
            converted += 1;
          }
        } catch (error) {
          // One row that cannot be converted (id and error class only) must not stop the others; it is retried by the next run.
          console.error(`[edging-mail] Could not encrypt message ${message.id}: ${errorClass(error)}`);
        }
      }
      if ((await legacyRowsLeft(db)) === 0) {
        await sweepLegacyObjects(env, db);
      }
    } finally {
      await releaseLease(db);
    }
    return { converted, remaining: await legacyRowsLeft(db) };
  } catch (error) {
    console.error('[edging-mail] The encryption job failed:', errorClass(error));
    return { converted, remaining: -1 };
  }
}
