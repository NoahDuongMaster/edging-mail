import { or, sql } from 'drizzle-orm';
import type { AnyColumn, SQL } from 'drizzle-orm';
import { messages } from './db/schema';
import type { Env } from './types';

// The one place that touches mail CONTENT: the R2 objects (raw .eml, attachment bytes) and the text columns that search looks into.
// Routes and services go through here, so that a change in how content is stored (for example encrypting it) has a single seam.

export const MAX_SEARCH_CHARS = 200;

// D1 refuses LIKE patterns over 50 bytes (a long search or a CJK label would be an HTTP 500), so substring tests use instr():
// case-insensitive for ASCII like LIKE was, and %, _ and \ are ordinary characters.
export const contains = (column: AnyColumn, text: string): SQL => sql`instr(lower(${column}), lower(${text})) > 0`;

/**
 * Mail that matches a search text: sender address and name, recipients. The server cannot read subjects or bodies (they are encrypted), so
 * it never searches them, also not in a legacy plaintext row that is still waiting for the encryption job: one rule. The browser filters
 * decrypted subjects over what it has loaded.
 */
export const searchCondition = (search: string): SQL | undefined =>
  or(contains(messages.from_address, search), contains(messages.from_name, search), contains(messages.to_address, search));

/**
 * Writes an R2 object. No custom metadata and a generic content type, on purpose: what an object is called or what it holds is known
 * from D1 only, and downloads set their own headers.
 */
export const putBlob = (env: Env, key: string, body: ArrayBuffer | ArrayBufferView | string): Promise<R2Object> =>
  env.BUCKET.put(key, body, { httpMetadata: { contentType: 'application/octet-stream' } });

/** Reads an R2 object. The caller must already have checked in D1 that the key belongs to the signed-in user. */
export const getBlob = (env: Env, key: string): Promise<R2ObjectBody | null> => env.BUCKET.get(key);

// R2 deletes up to 1000 keys per call.
const R2_DELETE_BATCH = 1000;

/** Deletes R2 objects, best effort: a key that fails is logged (count only) and the rest still go. Returns how many failed. */
export async function deleteBlobs(env: Env, keys: string[]): Promise<number> {
  let failed = 0;
  for (let start = 0; start < keys.length; start += R2_DELETE_BATCH) {
    const results = await Promise.allSettled([env.BUCKET.delete(keys.slice(start, start + R2_DELETE_BATCH))]);
    failed += results.filter((result) => result.status === 'rejected').length;
  }
  if (failed > 0) {
    console.error(`[edging-mail] ${failed} R2 delete call(s) failed; the objects stay until removed by hand`);
  }
  return failed;
}
