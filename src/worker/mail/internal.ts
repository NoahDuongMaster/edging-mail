import { Hono } from 'hono';
import { and, eq, inArray } from 'drizzle-orm';
import { routingAddress } from '../addresses';
import { lookupKeys, ownersOf } from '../auth/lookup';
import type { Owner } from '../auth/lookup';
import { currentUser } from '../auth/middleware';
import { dataKeysOf } from '../auth/secrets';
import { claimAttempt, INTERNAL_SEND_POLICY, spendBudget } from '../auth/throttle';
import { getDb } from '../db';
import type { Db } from '../db';
import { messages, users, attachments } from '../db/schema';
import { apiError } from '../errors';
import { notifyNewMail } from '../notify';
import { broadcast } from '../realtime';
import type { AppEnv, Env } from '../types';
import { MAX_INTERNAL_BODY_BYTES, INTERNAL_DAILY_BYTES, INTERNAL_DAILY_WINDOW_MS } from './internal-limits';
import { parseInternal, readJsonLimited } from './internal-request';
import type { InternalRequest, RecipientCopy } from './internal-request';
import { IdInUseError, planPlain, planSealed, storeCopies, threadsFor } from './internal-store';
import type { Mail, Planned } from './internal-store';
import { userRecipient } from './recipient';
import type { Recipient } from './seal';
import { errorClass, nonEmpty } from '../utils';

// POST /api/messages/internal: end-to-end mail between people on this deployment (crypto-design.md section 6, reports/e2e-contract.md).
// The browser seals one independent copy per recipient (its own content key and ids) and one for the sender's Sent folder; the Worker checks
// the shape, that every copy is sealed to its person's CURRENT key, and the caps, then stores the rows. It never opens anything and never
// calls SEND_EMAIL. Only a copy for a person without keys arrives in the clear (over TLS); the server seals that one itself.

export const internalRoutes = new Hono<AppEnv>();

const MAX_IDS_PER_CHECK = 90;

interface Person {
  owner: Owner;
  copy: RecipientCopy;
}

/** One copy per recipient PERSON, each naming one of the typed addresses of that person; null when they do not match exactly. */
function matchCopies(request: InternalRequest, owners: Map<string, Owner>): Person[] | null {
  const typed = new Set([...request.to, ...request.cc, ...request.bcc].map((address) => routingAddress(address) ?? ''));
  const people = new Set([...typed].map((address) => owners.get(address)?.user_id));
  const seen = new Set<string>();
  const matched: Person[] = [];
  for (const copy of request.copies) {
    const routed = routingAddress(copy.address);
    const owner = routed !== null && typed.has(routed) ? owners.get(routed) : undefined;
    if (owner === undefined || seen.has(owner.user_id)) {
      return null;
    }
    seen.add(owner.user_id);
    matched.push({ owner, copy });
  }
  return seen.size === people.size ? matched : null;
}

/** An id that is already in use (a row or an attachment): ids are chosen by the browser and the server never overwrites. */
async function anyIdInUse(db: Db, request: InternalRequest): Promise<boolean> {
  const rows = [request.sent.id, ...request.copies.flatMap((copy) => (copy.sealed === undefined ? [] : [copy.sealed.id]))];
  const files = [request.sent, ...request.copies.flatMap((copy) => (copy.sealed === undefined ? [] : [copy.sealed]))].flatMap((part) =>
    part.attachments.map((attachment) => attachment.id)
  );
  const found = await db.select({ id: messages.id }).from(messages).where(inArray(messages.id, rows));
  if (found.length > 0) {
    return true;
  }
  for (let start = 0; start < files.length; start += MAX_IDS_PER_CHECK) {
    const clash = await db
      .select({ id: attachments.id })
      .from(attachments)
      .where(inArray(attachments.id, files.slice(start, start + MAX_IDS_PER_CHECK)))
      .limit(1);
    if (clash.length > 0) {
      return true;
    }
  }
  return false;
}

/** Who can open a copy the server has to seal: the person's key if they have one by now, else the server (DATA_KEY). undefined: neither. */
async function recipientFor(env: Env, owner: Owner): Promise<Recipient | undefined> {
  if (owner.public_key !== null) {
    return userRecipient(owner.public_key);
  }
  const keys = await dataKeysOf(env);
  return keys === undefined ? undefined : { kind: 'server', keys };
}

internalRoutes.post('/messages/internal', async (c) => {
  const user = currentUser(c);
  const db = getDb(c.env.DB);
  try {
    // Counted before anything is read or parsed; without the throttle store there is no internal send.
    let claim;
    try {
      claim = await claimAttempt(db, `internal:${user.id}`, Date.now(), INTERNAL_SEND_POLICY);
    } catch (error) {
      console.error('[edging-mail] Internal send throttle unavailable:', errorClass(error));
      return apiError(c, 'unavailable', { error: 'Sending is temporarily unavailable' });
    }
    if (!claim.allowed) {
      c.header('Retry-After', String(claim.retryAfter));
      return apiError(c, 'too_many_requests', { retry_after: claim.retryAfter });
    }

    const read = await readJsonLimited(c.req.raw, MAX_INTERNAL_BODY_BYTES);
    if (read.tooLarge) {
      return apiError(c, 'payload_too_large');
    }
    const parsed = parseInternal(read.json);
    if (!parsed.ok) {
      return apiError(c, parsed.code, parsed.error === undefined ? {} : { error: parsed.error });
    }
    const request = parsed.value;

    // Every address must belong to a person here, and the copies must be exactly one per person.
    const typed = [...new Set([...request.to, ...request.cc, ...request.bcc].map((address) => address.toLowerCase()))];
    const owners = await ownersOf(
      db,
      typed.map((address) => routingAddress(address) ?? '')
    );
    const strangers = typed.filter((address) => !owners.has(routingAddress(address) ?? ''));
    if (strangers.length > 0) {
      return apiError(c, 'recipient_not_internal', { addresses: strangers });
    }
    const people = matchCopies(request, owners);
    if (people === null) {
      return apiError(c, 'copies_mismatch');
    }

    // Every sealed copy must be sealed to its person's CURRENT key (the sender's own too): otherwise nobody could open it.
    const me = await db.select({ public_key: users.public_key, key_id: users.key_id }).from(users).where(eq(users.id, user.id)).get();
    if (me === undefined) {
      return apiError(c, 'unauthorized');
    }
    const ownKey = { public_key: me.public_key, key_id: me.key_id };
    const stale =
      me.key_id !== request.sent.keyId || people.some(({ owner, copy }) => copy.sealed !== undefined && owner.key_id !== copy.sealed.keyId);
    if (stale) {
      return apiError(c, 'key_changed', { keys: await lookupKeys(db, typed), own_key: ownKey });
    }
    if (await anyIdInUse(db, request)) {
      return apiError(c, 'id_in_use');
    }

    const now = Date.now();
    const mail: Mail = {
      messageId: `<${crypto.randomUUID()}@${user.email.slice(user.email.lastIndexOf('@') + 1)}>`,
      from: user.email,
      fromName: nonEmpty(user.display_name) ?? null,
      to: request.to.join(', '),
      cc: request.cc.length > 0 ? request.cc.join(', ') : null,
      inReplyTo: request.inReplyTo ?? null,
      now,
      e2e: request.copies.every((copy) => copy.sealed !== undefined)
    };
    const threads = await threadsFor(db, [user.id, ...people.map(({ owner }) => owner.user_id)], mail, request.references);
    const threadOf = (userId: string) => threads.get(userId) ?? { threadId: mail.messageId, references: null };

    const planned: Planned[] = [
      planSealed(mail, threadOf(user.id), user.id, 'sent', request.bcc.length > 0 ? request.bcc.join(', ') : null, request.sent)
    ];
    for (const { owner, copy } of people) {
      if (copy.sealed !== undefined) {
        planned.push(planSealed(mail, threadOf(owner.user_id), owner.user_id, 'inbox', null, copy.sealed));
        continue;
      }
      const recipient = await recipientFor(c.env, owner);
      if (recipient === undefined || copy.plain === undefined) {
        // No key to seal to and no DATA_KEY to hold it under: refused, never stored in plaintext.
        return apiError(c, 'not_configured');
      }
      planned.push(await planPlain(mail, threadOf(owner.user_id), owner.user_id, recipient, copy.plain));
    }

    // The daily byte budget (EC-6) is spent last, when everything else has checked out, so a refusal above costs nothing. Fails closed: an error
    // here is the 500 below and nothing is stored.
    const budget = await spendBudget(db, `internalbytes:${user.id}`, read.bytes, INTERNAL_DAILY_BYTES, now, INTERNAL_DAILY_WINDOW_MS);
    if (!budget.ok) {
      c.header('Retry-After', String(budget.retryAfter));
      return apiError(c, 'too_many_requests', { retry_after: budget.retryAfter });
    }

    if (!(await storeCopies(c.env, db, planned))) {
      return apiError(c, 'key_changed', { keys: await lookupKeys(db, typed), own_key: ownKey });
    }

    // Stored. What follows is best effort: the draft is done, the sender's other tabs and every recipient are told (sender name and ids only).
    const [sent, ...received] = planned;
    c.executionCtx.waitUntil(
      (async () => {
        if (request.draftId !== undefined) {
          await db
            .delete(messages)
            .where(and(eq(messages.id, request.draftId), eq(messages.folder, 'drafts'), eq(messages.user_id, user.id)));
        }
        await Promise.allSettled([
          broadcast(c.env, user.id, { type: 'mail.changed' }),
          ...received.map((copy) => notifyNewMail(c.env, copy.row))
        ]);
      })().catch((error: unknown) => {
        console.error('[edging-mail] Internal send follow-up failed:', errorClass(error));
      })
    );
    return c.json({
      success: true,
      e2e: mail.e2e,
      message: sent.row,
      copies: people.map(({ copy }, index) => ({ address: copy.address, id: received[index]?.row.id, sealed: copy.sealed !== undefined }))
    });
  } catch (error) {
    if (error instanceof IdInUseError) {
      // Another request stored one of these ids between the check and the write; nothing of this request is left (rows or objects).
      return apiError(c, 'id_in_use');
    }
    // The class only: the message of a storage or database error can carry ids, addresses or sealed values.
    console.error('[edging-mail] Internal send failed:', errorClass(error));
    return apiError(c, 'server_error');
  }
});
