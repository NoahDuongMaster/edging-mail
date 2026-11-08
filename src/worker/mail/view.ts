import { and, eq, ne, notInArray } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { domainOf } from '../addresses';
import { contains, searchCondition } from '../content';
import type { Db } from '../db';
import { domains, messages } from '../db/schema';
import type { Folder } from '../db/schema';
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

// Page and limit: a non-numeric value takes the default and a huge page is capped, instead of reaching D1 as NaN or a
// float (HTTP 500). Valid values behave as before.
export const intParam = (value: string | undefined, fallback: number, max: number): number => {
  const parsed = Number.parseInt(nonEmpty(value) ?? '', 10);
  return Number.isNaN(parsed) ? fallback : Math.min(max, Math.max(1, parsed));
};

// The rows of one folder view (a folder, the starred view or a label) of ONE user, narrowed by a search text: the list and
// "mark all as read" use the same one, so the button always means exactly what the list shows.
export const viewFilter = (userId: string, folder: string, search: string): SQL | undefined => {
  const filters: (SQL | undefined)[] = [ownedBy(userId)];

  if (folder === 'starred') {
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
