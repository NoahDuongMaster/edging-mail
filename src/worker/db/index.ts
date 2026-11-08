import { DrizzleQueryError } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import { drizzle, type DrizzleD1Database } from 'drizzle-orm/d1';

export type Db = DrizzleD1Database & { $client: D1Database };
export const getDb = (d1: D1Database): Db => drizzle(d1);

// A list of queries built at run time, for runBatch.
export type BatchQuery = BatchItem<'sqlite'>;

/** db.batch (one transaction: all or nothing) for a list whose length is only known at run time. Nothing to run is fine. */
export const runBatch = async (db: Db, queries: BatchQuery[]): Promise<void> => {
  const [first, ...rest] = queries;
  if (queries.length > 0) {
    await db.batch([first, ...rest]);
  }
};

/** db.batch for a list known only at run time, answering how many rows each statement changed (0 for a statement that returns rows). */
export const batchChanges = async (db: Db, queries: BatchQuery[]): Promise<number[]> => {
  const [first, ...rest] = queries;
  if (queries.length === 0) {
    return [];
  }
  const results = (await db.batch([first, ...rest])) as unknown as { meta?: { changes?: number } }[];
  return results.map((result) => result.meta?.changes ?? 0);
};

// Drizzle wraps driver failures in DrizzleQueryError (message = SQL + params).
// The API has always answered with the plain D1 message, so unwrap it.
export const errorMessage = (error: unknown): string => {
  if (error instanceof DrizzleQueryError && error.cause) {
    return error.cause.message;
  }
  return error instanceof Error ? error.message : String(error);
};
