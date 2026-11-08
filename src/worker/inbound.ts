import { and, eq, isNull, sql } from 'drizzle-orm';
import { routingAddress } from './addresses';
import { hasUsers } from './auth/accounts';
import { dataKeysOf } from './auth/secrets';
import { getDb } from './db';
import type { Db } from './db';
import { addresses, messages, users } from './db/schema';
import { errorClass } from './utils';
import { userRecipient } from './mail/recipient';
import type { Recipient } from './mail/seal';
import { parseAndStoreEmail } from './services/email-parser';
import type { RunStage, Stage } from './services/email-parser';
import type { Env } from './types';

type Owner = { known: true; ownerId: string | null; publicKey: string | null } | { known: false };

// The largest mail that is sealed on arrival. Parsing, the raw copy and every encrypted blob live in the Worker's memory at once (128 MB per
// request), so a mail near Email Routing's own 25 MiB limit is refused with a clear text rather than risking a crash that loses it. The
// limit is a conservative estimate (about five copies of the mail in memory), not a measured peak.
export const MAX_SEALED_MAIL_BYTES = 20 * 1024 * 1024;

// A storage hiccup must not bounce a customer's mail (setReject is permanent: the sender is told the mail failed and does not try again). The two
// D1 steps below are safe to repeat, so each gets three attempts in all, with a pause before the second and the third. Nothing else is repeated.
const ATTEMPTS = 3;
const BACKOFF_MS = [100, 400] as const;
const REPEATED: ReadonlySet<Stage> = new Set<Stage>(['resolve', 'store-row']);

const pause = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/** Runs one step, repeating it when it is one of the repeatable ones. The last failure is thrown as it is. */
async function attempt<T>(stage: Stage, run: () => Promise<T>): Promise<T> {
  for (let tries = 1; ; tries += 1) {
    try {
      return await run();
    } catch (error) {
      if (!REPEATED.has(stage) || tries >= ATTEMPTS) {
        throw error;
      }
      // The stage, the number of the attempt and the error class: nothing about the mail.
      console.warn(`[edging-mail] Inbound email: ${stage} failed on attempt ${tries} of ${ATTEMPTS}, trying again: ${errorClass(error)}`);
      await pause(BACKOFF_MS[tries - 1]);
    }
  }
}

// Whose mail is this? The envelope recipient decides, lower-cased and without a "+tag", looked up among primary addresses and aliases.
// A disabled user still receives. While no user exists yet (before Setup) every address is accepted and the mail has no owner:
// Setup assigns it to the admin. Afterwards an address nobody owns is unknown.
async function resolveRecipient(db: Db, envelopeTo: string): Promise<Owner> {
  const address = routingAddress(envelopeTo);
  const owner =
    address === null
      ? undefined
      : await db
          .select({ userId: addresses.user_id, publicKey: users.public_key })
          .from(addresses)
          .innerJoin(users, eq(users.id, addresses.user_id))
          .where(eq(addresses.address, address))
          .get();
  if (owner !== undefined) {
    return { known: true, ownerId: owner.userId, publicKey: owner.publicKey };
  }
  return (await hasUsers(db)) ? { known: false } : { known: true, ownerId: null, publicKey: null };
}

// Who can open the content key of this mail: the owner's public key, or (no key yet) the server under DATA_KEY. undefined = neither is
// available, and the mail is refused: nothing is ever stored in plaintext.
async function recipientFor(env: Env, owner: { publicKey: string | null }): Promise<Recipient | undefined> {
  if (owner.publicKey !== null) {
    return userRecipient(owner.publicKey);
  }
  const keys = await dataKeysOf(env);
  return keys === undefined ? undefined : { kind: 'server', keys };
}

// A mail stored without an owner just before Setup committed would stay invisible for ever (Setup's own update ran first). After a
// storing with no owner, hand any such row to the admin if a user exists by now. Idempotent.
async function adoptOrphanMail(db: Db): Promise<void> {
  await db
    .update(messages)
    .set({ user_id: sql`(SELECT id FROM users WHERE role = 'admin' ORDER BY created_at LIMIT 1)` })
    .where(and(isNull(messages.user_id), sql`EXISTS (SELECT 1 FROM users)`));
}

/** The `email()` handler: Email Routing delivers every message of every configured domain here (catch-all rule). */
export async function receiveEmail(message: ForwardableEmailMessage, env: Env): Promise<void> {
  const db = getDb(env.DB);
  // The step that is running, named in the failure log line (one of five fixed words, see Stage).
  let stage: Stage = 'resolve';
  const run: RunStage = (next, work) => {
    stage = next;
    return attempt(next, work);
  };
  try {
    console.log('[edging-mail] Incoming email');
    // Resolved BEFORE anything is parsed or written: a message nobody owns leaves no row and no R2 object behind.
    const owner = await run('resolve', () => resolveRecipient(db, message.to));
    if (!owner.known) {
      // The sending server sees this text.
      message.setReject('Unknown recipient');
      return;
    }
    if (message.rawSize > MAX_SEALED_MAIL_BYTES) {
      message.setReject('Message too large');
      return;
    }
    const recipient = await run('seal', () => recipientFor(env, owner));
    if (recipient === undefined) {
      // No key to seal to and no DATA_KEY to hold it under: refused, not stored in plaintext. Cloudflare documents setReject as a permanent error, so the sender is bounced and the mail cannot be recovered (an uncaught throw would end in a permanent error as well).
      console.error('[edging-mail] Inbound mail refused: the recipient has no key and DATA_KEY is not usable');
      message.setReject('Message could not be processed');
      return;
    }
    await parseAndStoreEmail(message.raw, env, {
      envelopeFrom: message.from,
      envelopeTo: message.to,
      ownerId: owner.ownerId,
      recipient,
      run
    });
    if (owner.ownerId === null) {
      await run('store-row', () => adoptOrphanMail(db));
    }
    console.log('[edging-mail] Inbound email successfully processed and stored in D1 & R2');
  } catch (error) {
    // The step and the error class only: a Drizzle error carries the SQL parameters, a parser error can carry a fragment of the mail. Whatever is left
    // after the repeats is final: setReject is permanent, so the sender is told and the mail is not stored.
    console.error(`[edging-mail] Failed to process inbound email at stage ${stage}: ${errorClass(error)}`);
    // The sender's server sees this text: no internal details.
    message.setReject('Message could not be processed');
  }
}
