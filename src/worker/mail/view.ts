import { and, eq, inArray, ne, notInArray } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { domainOf } from '../addresses';
import { contains, searchCondition } from '../content';
import type { Db } from '../db';
import { domains, messages, userAvatars, users } from '../db/schema';
import type { Folder, MessageOrigin } from '../db/schema';
import { senderPictureIds } from '../pictures';
import type { Background } from '../pictures';
import { dmarcPassed } from '../spam/auth-results';
import { nonEmpty } from '../utils';

/** Every query on `messages` carries this: a row is reachable only by its owner. A foreign id is simply "not found". */
export const ownedBy = (userId: string): SQL => eq(messages.user_id, userId);

/**
 * `from_hosted` on every row (PX-12): whether the From address is on a domain this deployment hosts (the admin's domain list), worked out when the
 * rows are read, so adding or removing a domain changes it at once. Mail that arrived by email (`origin: 'smtp'`) carries whatever From address its
 * sender wrote; the app shows a warning on such a row when this is true. The domain is the part after the LAST `@`, as everywhere else.
 */
export async function withFromHosted<T extends { from_address: string }>(db: Db, rows: T[]): Promise<(T & { from_hosted: boolean })[]> {
  if (rows.length === 0) {
    return [];
  }
  const names = await db.select({ name: domains.name }).from(domains);
  const hosted = new Set(names.map((row) => row.name));
  return rows.map((row) => ({
    ...row,
    from_hosted: row.from_address.includes('@') && hosted.has(domainOf(row.from_address.trim().toLowerCase()))
  }));
}

// D1 binds at most 100 values to one statement.
const D1_BOUND_VALUES = 100;

/**
 * `from_avatar` on every row: the id of a picture to show for the sender, or null. Worked out when the rows are read, so a new or removed picture shows
 * at once. One query per 100 senders for each kind of row, never one per row. `from_hosted` must already be on the rows (`withFromHosted`).
 *
 * - Mail written in the app (`origin: 'internal'`, where the From address is the signed-in author): the profile picture of the person whose primary
 *   address is the From address (lower-cased, trimmed).
 * - Mail that arrived by email (`origin: 'smtp'`) from an address that is NOT on a domain this deployment hosts (`from_hosted: false`) AND whose `auth`
 *   says `dmarc=pass` (Cloudflare checked that the From domain vouches for the mail): the picture of that outside sender (pictures.ts), only while an
 *   admin has the `outside_pictures` setting on (off by default: then no lookup is ever made and this is null). A From address nobody authenticated
 *   (`auth` NULL, or any other DMARC result) never gets one, and is never looked up: Gravatar's picture of a claimed address must not decorate mail that
 *   only claims to be from it. Pictures come from `sender_pictures` only; what is missing or due is looked up in the BACKGROUND (`background`, which
 *   runs after the response), so a request never waits for Gravatar or Libravatar and the first time a sender is seen shows no picture.
 * - Mail that arrived by email with `from_hosted: true` is always null, also when the address belongs to a person here with a picture: that From address
 *   is only what the sender wrote, and a picture on it would help somebody pose as that person (the same reason as `from_hosted`). A picture on outside
 *   mail is exactly as unverified as its From address.
 */
export async function withFromAvatar<T extends { from_address: string; origin: MessageOrigin; from_hosted: boolean; auth: string | null }>(
  db: Db,
  rows: T[],
  background: Background
): Promise<(T & { from_avatar: string | null })[]> {
  const senders = rows.map((row) => (row.origin === 'internal' ? row.from_address.trim().toLowerCase() : null));
  const wanted = [...new Set(senders.filter((address): address is string => address !== null))];
  const pictures = new Map<string, string>();
  for (let start = 0; start < wanted.length; start += D1_BOUND_VALUES) {
    const found = await db
      .select({ email: users.email, avatar: userAvatars.id })
      .from(userAvatars)
      .innerJoin(users, eq(users.id, userAvatars.user_id))
      .where(inArray(users.email, wanted.slice(start, start + D1_BOUND_VALUES)));
    for (const row of found) {
      pictures.set(row.email, row.avatar);
    }
  }
  // Only mail that arrived by email from an address that is not hosted here, and whose From domain passed DMARC, is a candidate; everything else is null here.
  const outside = await senderPictureIds(
    db,
    rows.map((row) => (row.origin === 'smtp' && !row.from_hosted && dmarcPassed(row.auth) ? row.from_address : null)),
    background
  );
  return rows.map((row, index) => ({ ...row, from_avatar: pictures.get(senders[index] ?? '') ?? outside[index] ?? null }));
}

// Page and limit: a non-numeric value takes the default and a huge page is capped, instead of reaching D1 as NaN or a
// float (HTTP 500). Valid values behave as before.
export const intParam = (value: string | undefined, fallback: number, max: number): number => {
  const parsed = Number.parseInt(nonEmpty(value) ?? '', 10);
  return Number.isNaN(parsed) ? fallback : Math.min(max, Math.max(1, parsed));
};

/** The folder view `all` ("All mail", search across folders): every folder except these two. Rows keep their own `folder`. */
export const OUTSIDE_ALL_MAIL: Folder[] = ['trash', 'spam'];

// The rows of one folder view (a folder, `all`, the starred view or a label) of ONE user, narrowed by a search text: the list and
// "mark all as read" use the same one, so the button always means exactly what the list shows.
export const viewFilter = (userId: string, folder: string, search: string): SQL | undefined => {
  const filters: (SQL | undefined)[] = [ownedBy(userId)];

  if (folder === 'all') {
    filters.push(notInArray(messages.folder, OUTSIDE_ALL_MAIL));
  } else if (folder === 'starred') {
    filters.push(and(eq(messages.is_starred, 1), ne(messages.folder, 'trash')));
  } else if (folder.startsWith('label:')) {
    // Labels are stored as a JSON array, so the quoted name only matches a whole label.
    filters.push(and(contains(messages.labels, `"${folder.slice(6)}"`), notInArray(messages.folder, ['trash', 'spam'])));
  } else {
    filters.push(eq(messages.folder, folder as Folder));
  }

  if (search) {
    filters.push(searchCondition(search));
  }

  return and(...filters);
};
