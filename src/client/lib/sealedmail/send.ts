import type { Message } from '../../types';
import { ApiError } from '../api';
import { getUnlockedKey } from '../crypto/keyStore';
import type { UnlockedKey } from '../crypto/keyStore';
import { buildCopies, requestBody } from './build';
import type { SendHeaders } from './build';
import { SealedMailError } from './errors';
import { assertSendable } from './guard';
import type { Confirmed } from './guard';
import { isRecord } from './helpers';
import { canonicalList, parseAnswers } from './lookup';
import { rememberKeys } from './plan';
import type { SendPlan } from './plan';
import { browserFetch, failureOf, postJson, succeeded } from './request';
import type { Answer, Fetcher, Success } from './request';
import { LIMITS } from './limits';
import type { LookupMap, MailContent, OutgoingAttachment, PlainCopy } from './types';

export type { SendHeaders } from './build';
export type { Confirmed } from './guard';

export interface SendInput {
  content: MailContent;
  attachments: readonly OutgoingAttachment[];
  headers: SendHeaders;
  plan: SendPlan;
  /** What the person agreed to; must cover `plan.needsConfirm`. */
  confirmed: Confirmed;
  fetcher?: Fetcher;
}

export interface SentCopy {
  address: string;
  id: string;
  /** False for a copy the server had to seal itself (a person without keys). */
  sealed: boolean;
}

export type SendResult =
  /** Stored. `e2e` is true only when no plaintext copy was sent AND the server says so. `message` is the Sent row. */
  | { status: 'sent'; e2e: boolean; message: Message | null; copies: SentCopy[] }
  /** A key changed while the person wrote: nothing was stored and nothing was resent. `keys` is the server's lookup for every address; plan again with it. */
  | { status: 'key_changed'; keys: LookupMap; ownKeyChanged: boolean };

const INTERNAL_URL = '/api/messages/internal';

function sentOf(success: Success, plainCopies: number): SendResult {
  // The message is stored by now: whatever is odd in the answer, this is not a failure.
  const { data } = success;
  const copies = Array.isArray(data.copies) ? (data.copies as unknown[]) : [];
  return {
    status: 'sent',
    e2e: data.e2e === true && plainCopies === 0,
    message: isRecord(data.message) && typeof data.message.id === 'string' ? (data.message as unknown as Message) : null,
    copies: copies.flatMap((copy) =>
      isRecord(copy) && typeof copy.address === 'string' && typeof copy.id === 'string' && typeof copy.sealed === 'boolean'
        ? [{ address: copy.address, id: copy.id, sealed: copy.sealed }]
        : []
    )
  };
}

/** The 409: the lookup for every address of the request (and the sender's own key id). null when it is not a well formed answer. */
async function changedOf(data: Record<string, unknown>, expected: readonly string[], own: UnlockedKey): Promise<SendResult | null> {
  try {
    const keys = await parseAnswers(data.keys, expected);
    const ownKey = data.own_key;
    return {
      status: 'key_changed',
      keys,
      ownKeyChanged: isRecord(ownKey) && typeof ownKey.key_id === 'string' && ownKey.key_id !== own.keyId
    };
  } catch {
    return null;
  }
}

async function submit(
  body: string,
  expected: readonly string[],
  plainCopies: number,
  own: UnlockedKey,
  fetcher: Fetcher
): Promise<SendResult> {
  if (body.length > LIMITS.requestBytes) {
    throw new SealedMailError('too_big', { problems: [{ kind: 'request_too_big', limit: LIMITS.requestBytes, actual: body.length }] });
  }
  const answer: Answer = await postJson(INTERNAL_URL, body, fetcher);
  if (succeeded(answer)) {
    return sentOf(answer, plainCopies);
  }
  if (answer.res.status === 409 && answer.data?.code === 'key_changed') {
    // Never resent from here: the keys are the person's to look at first (S3).
    const changed = await changedOf(answer.data, expected, own);
    if (changed !== null) {
      return changed;
    }
  }
  throw failureOf(answer, 'fail.sealed_send');
}

/**
 * Sends one end-to-end message to people on this deployment: seals the sender's Sent copy to the unlocked key and one copy per recipient person,
 * and posts them. Nothing is sealed or posted when the key is locked, the plan is not internal or not what the headers say, a confirmation is
 * missing, or the message is over a cap. The request body holds no plaintext, except the copy of a person without keys, and only once confirmed.
 * A 409 `key_changed` is returned, not retried. After a success the plan's new keys are pinned (trust on first use), and the changed keys the
 * person confirmed are accepted.
 */
export async function sendInternal(input: SendInput): Promise<SendResult> {
  const own = getUnlockedKey();
  if (own === null) {
    throw new SealedMailError('locked');
  }
  const { content, attachments, headers, plan, confirmed, fetcher = browserFetch } = input;
  assertSendable(plan, headers, confirmed, content, attachments);
  const built = await buildCopies(content, attachments, plan, own.publicKey);
  const expected = canonicalList(headers.to, headers.cc, headers.bcc);
  const post = (plain: readonly PlainCopy[]): Promise<SendResult> =>
    submit(requestBody(headers, built, plain), expected, plain.length, own, fetcher);

  let result: SendResult;
  try {
    result = await post(built.plain);
  } catch (error) {
    // The server wants one copy per PERSON. Two addresses of one person without keys (an alias) look like two people here, and it answers
    // `copies_mismatch`. Retry ONCE with every keyless address folded into the copy of the first one: right when they are one person; when
    // they are different people the server answers `copies_mismatch` again and that answer is the error.
    if (error instanceof ApiError && error.code === 'copies_mismatch' && built.plain.length > 1) {
      result = await post(built.plain.slice(0, 1));
    } else {
      throw error;
    }
  }
  if (result.status === 'sent') {
    rememberKeys(own.userId, plan, confirmed.changedKeys);
  }
  return result;
}
