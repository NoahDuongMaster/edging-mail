import { eq, inArray, sql } from 'drizzle-orm';
import type { Db } from './db';
import { senderPictures, settings } from './db/schema';
import { addressHash, lookableAddress, lookUpPicture } from './picture-lookup';
import type { Lookup } from './picture-lookup';
import { errorClass } from './utils';

// Pictures of senders who are not on this deployment. While an admin has the organisation setting `outside_pictures` on (off by default), the WORKER
// asks Gravatar and then Libravatar's central server for the picture of an address (picture-lookup.ts), keeps what it gets in `sender_pictures` and
// serves it from this origin like any other picture (`GET /api/avatars/:id`). The browser never contacts either: the page's policy is unchanged and
// `from_avatar` only ever holds an id.
//
// A request never waits for a provider (`senderPictureIds`): a sender seen for the first time shows initials, and the lookup runs in the background
// so that the next read of the mail shows the picture.
//
// Only mail whose From domain passed DMARC (the `auth` Cloudflare recorded says `dmarc=pass`) is looked up or shown a picture: the From address of other mail is
// only a claim, and a picture of the claimed sender would make it look genuine. The caller decides (mail/view.ts `withFromAvatar`); nothing here sees an address
// of unauthenticated mail.

/** The `settings` key: '1' = on; absent or anything else = off. */
export const OUTSIDE_PICTURES_KEY = 'outside_pictures';

const DAY_MS = 24 * 60 * 60 * 1000;
/** A picture older than this is still shown while it is looked up again. */
export const REFRESH_FOUND_MS = 30 * DAY_MS;
/** Nothing found: the sender is not asked again before this. */
export const RECHECK_NONE_MS = 7 * DAY_MS;
/** A lookup that failed for a transient reason (network, timeout, 5xx, 429) is retried after this. */
export const RETRY_FAILED_MS = 60 * 60 * 1000;

const MAX_LOOKUPS_PER_REQUEST = 10;
const LOOKUP_CONCURRENCY = 3;
// D1 binds at most 100 values to one statement.
const D1_BOUND_VALUES = 100;

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  // In slices: spreading a large array into one call overflows the stack.
  for (let start = 0; start < bytes.length; start += 0x80_00) {
    binary += String.fromCodePoint(...bytes.subarray(start, start + 0x80_00));
  }
  return btoa(binary);
}

/**
 * Keeps the answer of a lookup, one row per hash. The id stays while the bytes stay and is new when they change (also when a picture is gone: its old
 * id then answers 404). A failure that may pass keeps a picture already held and only moves `checked_at` back so that the next read asks again after
 * `RETRY_FAILED_MS`; with no row yet it stores a 'none' marker dated the same way. The write happens only while the setting is on, in the same
 * statement, so a lookup that was in flight when an admin turned the setting off cannot leave a row behind.
 */
export async function recordLookup(db: Db, hash: string, answer: Lookup, now = Date.now()): Promise<void> {
  const on = sql`EXISTS (SELECT 1 FROM ${settings} WHERE ${settings.key} = ${OUTSIDE_PICTURES_KEY} AND ${settings.value} = '1')`;
  const found = answer.kind === 'found';
  const mime = found ? answer.mime : null;
  const data = found ? toBase64(answer.bytes) : null;
  // A failure is dated so that it is due again after RETRY_FAILED_MS (a held picture is due after 30 days, a marker after 7).
  const failedAt = (maxAge: number): number => now - (maxAge - RETRY_FAILED_MS);
  const checkedAt = answer.kind === 'failed' ? failedAt(RECHECK_NONE_MS) : now;
  const insert = db
    .insert(senderPictures)
    .select(sql`SELECT ${crypto.randomUUID()}, ${hash}, ${found ? 1 : 0}, ${mime}, ${data}, ${checkedAt} WHERE ${on}`);
  await (answer.kind === 'failed'
    ? insert.onConflictDoUpdate({
        target: senderPictures.address_hash,
        set: {
          checked_at: sql`CASE WHEN ${senderPictures.found} = 1 THEN ${failedAt(REFRESH_FOUND_MS)} ELSE ${failedAt(RECHECK_NONE_MS)} END`
        }
      })
    : insert.onConflictDoUpdate({
        target: senderPictures.address_hash,
        set: {
          id: sql`CASE WHEN ${senderPictures.found} = excluded.found AND ${senderPictures.data} IS excluded.data THEN ${senderPictures.id} ELSE excluded.id END`,
          found: sql`excluded.found`,
          mime: sql`excluded.mime`,
          data: sql`excluded.data`,
          checked_at: sql`excluded.checked_at`
        }
      }));
}

export async function outsidePicturesOn(db: Db): Promise<boolean> {
  const row = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, OUTSIDE_PICTURES_KEY)).get();
  return row?.value === '1';
}

// A lookup that is running in this Worker instance (one request's list and the next request's detail would otherwise ask twice).
const running = new Set<string>();

/** Runs `job` over `items`, at most `limit` at a time. */
async function inParallel<T>(items: readonly T[], limit: number, job: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const lane = async (): Promise<void> => {
    while (next < items.length) {
      const item = items[next++];
      if (item !== undefined) {
        await job(item);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
}

/** Looks the hashes up (three at a time) and keeps the answers. Never rejects: a failure is logged by its class only, never with the hash. */
export async function refreshPictures(db: Db, hashes: readonly string[]): Promise<void> {
  const todo = [...new Set(hashes)].filter((hash) => !running.has(hash));
  for (const hash of todo) {
    running.add(hash);
  }
  await inParallel(todo, LOOKUP_CONCURRENCY, async (hash) => {
    try {
      await recordLookup(db, hash, await lookUpPicture(hash));
    } catch (error) {
      console.error('[edging-mail] Sender picture lookup failed:', errorClass(error));
    } finally {
      running.delete(hash);
    }
  });
}

/** A held row is due for a new lookup: none yet, a marker older than 7 days (a failure that may pass: 1 hour), or a picture older than 30 days. */
export const isDue = (row: { found: number; checked_at: number } | undefined, now: number): boolean =>
  row === undefined || now - row.checked_at >= (row.found === 1 ? REFRESH_FOUND_MS : RECHECK_NONE_MS);

/** Runs a promise after the response has gone (`c.executionCtx.waitUntil`). */
export type Background = (work: Promise<unknown>) => void;

/**
 * For each From address (null = not a sender to look up), the id of the held picture of that sender, or null. Only while the setting is on. The
 * answer comes from `sender_pictures` alone (one query per 100 hashes); what is missing or due is looked up in the BACKGROUND (at most 10 per
 * request, three at a time), so the request never waits for a provider and a first view shows no picture. The caller decides which rows are
 * eligible (mail that arrived by email from an address that is not on a hosted domain and whose From domain passed DMARC): this function never sees anything else.
 */
export async function senderPictureIds(db: Db, addresses: readonly (string | null)[], background: Background): Promise<(string | null)[]> {
  const none = addresses.map(() => null);
  if (addresses.every((address) => address === null) || !(await outsidePicturesOn(db))) {
    return none;
  }
  const hashes = await Promise.all(
    addresses.map(async (address) => {
      const plain = address === null ? null : lookableAddress(address);
      return plain === null ? null : addressHash(plain);
    })
  );
  const wanted = [...new Set(hashes.filter((hash): hash is string => hash !== null))];
  const held = new Map<string, { id: string; found: number; checked_at: number }>();
  for (let start = 0; start < wanted.length; start += D1_BOUND_VALUES) {
    const rows = await db
      .select({
        hash: senderPictures.address_hash,
        id: senderPictures.id,
        found: senderPictures.found,
        checked_at: senderPictures.checked_at
      })
      .from(senderPictures)
      .where(inArray(senderPictures.address_hash, wanted.slice(start, start + D1_BOUND_VALUES)));
    for (const { hash, ...row } of rows) {
      held.set(hash, row);
    }
  }
  const now = Date.now();
  const due = wanted.filter((hash) => isDue(held.get(hash), now)).slice(0, MAX_LOOKUPS_PER_REQUEST);
  if (due.length > 0) {
    background(refreshPictures(db, due));
  }
  return hashes.map((hash) => {
    const row = hash === null ? undefined : held.get(hash);
    return row?.found === 1 ? row.id : null;
  });
}
