import { DrizzleQueryError } from 'drizzle-orm';
import { drizzle, type DrizzleD1Database } from 'drizzle-orm/d1';

export type Db = DrizzleD1Database & { $client: D1Database };
export const getDb = (d1: D1Database): Db => drizzle(d1);

// Drizzle wraps driver failures in DrizzleQueryError (message = SQL + params).
// The API has always answered with the plain D1 message, so unwrap it.
export const errorMessage = (error: unknown): string => {
  if (error instanceof DrizzleQueryError && error.cause) {
    return error.cause.message;
  }
  return error instanceof Error ? error.message : String(error);
};
