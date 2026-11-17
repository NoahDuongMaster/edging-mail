import { Hono } from 'hono';
import { and, asc, eq, sql } from 'drizzle-orm';
import { currentUser } from '../auth/middleware';
import { getDb } from '../db';
import type { Db } from '../db';
import { mailFilters } from '../db/schema';
import type { FilterKind } from '../db/schema';
import { apiError, failed } from '../errors';
import type { AppEnv } from '../types';
import { jsonObject } from '../utils';
import { MAX_ENTRIES, normaliseEntry } from '../spam/lists';

// A person's allow and block lists for the spam filter (see spam/lists.ts for what an entry is and how it matches). Every query is scoped to the signed-in
// person: another person's entry is "not found", exactly like an id that does not exist.
export const filterRoutes = new Hono<AppEnv>();

const COLUMNS = { id: mailFilters.id, kind: mailFilters.kind, value: mailFilters.value, created_at: mailFilters.created_at };

export interface FilterRow {
  id: string;
  kind: FilterKind;
  value: string;
  created_at: number;
}

const isKind = (value: unknown): value is FilterKind => value === 'allow' || value === 'block';

/**
 * Adds an entry unless the person already has it or already has MAX_ENTRIES of them; the count and the insert are ONE statement, so two requests at the limit
 * cannot both get in. Returns the new row, or undefined when nothing was added (it exists, or the list is full).
 */
export async function addFilter(db: Db, userId: string, kind: FilterKind, value: string, now = Date.now()): Promise<FilterRow | undefined> {
  const [created] = await db
    .insert(mailFilters)
    .select(
      sql`SELECT ${crypto.randomUUID()}, ${userId}, ${kind}, ${value}, ${now} WHERE (SELECT COUNT(*) FROM ${mailFilters} WHERE ${mailFilters.user_id} = ${userId}) < ${MAX_ENTRIES}`
    )
    .onConflictDoNothing()
    .returning(COLUMNS);
  return created;
}

const findFilter = (db: Db, userId: string, kind: FilterKind, value: string): Promise<FilterRow | undefined> =>
  db
    .select(COLUMNS)
    .from(mailFilters)
    .where(and(eq(mailFilters.user_id, userId), eq(mailFilters.kind, kind), eq(mailFilters.value, value)))
    .get();

filterRoutes.get('/filters', async (c) => {
  try {
    const filters = await getDb(c.env.DB)
      .select(COLUMNS)
      .from(mailFilters)
      .where(eq(mailFilters.user_id, currentUser(c).id))
      .orderBy(asc(mailFilters.created_at), sql`rowid ASC`);
    return c.json({ success: true, filters });
  } catch (error) {
    return failed(c, error);
  }
});

filterRoutes.post('/filters', async (c) => {
  try {
    const userId = currentUser(c).id;
    const body = await jsonObject<{ kind?: unknown; value?: unknown }>(c.req, ['kind', 'value']);
    if (body === null) {
      return apiError(c, 'invalid_body');
    }
    const value = normaliseEntry(body.value);
    if (!isKind(body.kind) || value === null) {
      return apiError(c, 'invalid_filter', {
        error: isKind(body.kind)
          ? 'value must be an address (name@example.com) or a domain (example.com), at most 255 characters'
          : 'kind must be allow or block'
      });
    }
    const db = getDb(c.env.DB);
    // An entry the person already has is answered as it is: adding it twice is not an error (also when the list is full).
    const filter = (await addFilter(db, userId, body.kind, value)) ?? (await findFilter(db, userId, body.kind, value));
    return filter === undefined ? apiError(c, 'too_many_filters') : c.json({ success: true, filter });
  } catch (error) {
    return failed(c, error);
  }
});

filterRoutes.delete('/filters/:id', async (c) => {
  try {
    const gone = await getDb(c.env.DB)
      .delete(mailFilters)
      .where(and(eq(mailFilters.id, c.req.param('id')), eq(mailFilters.user_id, currentUser(c).id)))
      .returning({ id: mailFilters.id });
    return gone.length === 0 ? apiError(c, 'not_found') : c.json({ success: true });
  } catch (error) {
    return failed(c, error);
  }
});
