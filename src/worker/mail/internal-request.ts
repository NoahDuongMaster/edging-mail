import { routingAddress } from '../addresses';
import type { ErrorCode } from '../errors';
import { isMessageId, UUID_PATTERN } from '../services/email-sender';
import * as limit from './internal-limits';
import { addressList, isRecord, only, plainPart, refuse, Refusal, SEALED_KEYS, sealedPart, Totals } from './internal-parts';
import type { PlainPart, SealedPart } from './internal-parts';

// The request of `POST /api/messages/internal` (docs/api.md, reports/e2e-contract.md): its envelope, and one entry per recipient. The parts
// that carry content are checked in internal-parts.ts. Nothing here touches D1 or R2.

export interface RecipientCopy {
  address: string;
  sealed: SealedPart | undefined;
  plain: PlainPart | undefined;
}

export interface InternalRequest {
  to: string[];
  cc: string[];
  bcc: string[];
  inReplyTo: string | undefined;
  references: string[];
  draftId: string | undefined;
  sent: SealedPart;
  copies: RecipientCopy[];
}

export type Parsed = { ok: true; value: InternalRequest } | { ok: false; code: ErrorCode; error: string | undefined };

function recipientCopy(value: unknown, totals: Totals): RecipientCopy {
  if (!isRecord(value) || typeof value.address !== 'string') {
    refuse('invalid_request', 'A copy needs the address of its recipient');
  }
  const address = value.address.trim();
  if (value.plain !== undefined) {
    only(value, ['address', 'plain']);
    return { address, sealed: undefined, plain: plainPart(value.plain, totals) };
  }
  only(value, ['address', ...SEALED_KEYS]);
  return { address, sealed: sealedPart(value, 'copy', totals), plain: undefined };
}

/** Checks a decoded request body. Never throws for bad input: the answer says which registry code to use. */
export function parseInternal(body: unknown): Parsed {
  try {
    if (!isRecord(body)) {
      refuse('invalid_body');
    }
    only(body, ['to', 'cc', 'bcc', 'in_reply_to', 'references', 'draft_id', 'sent', 'copies']);
    const to = addressList(body.to, 'to', true);
    const cc = addressList(body.cc, 'cc', false);
    const bcc = addressList(body.bcc, 'bcc', false);
    if (to.length === 0) {
      refuse('invalid_request', 'to needs at least one address');
    }
    const distinct = new Set([...to, ...cc, ...bcc].map((address) => routingAddress(address)));
    if (distinct.size > limit.MAX_INTERNAL_RECIPIENTS) {
      refuse('too_many_recipients');
    }
    const inReplyTo = body.in_reply_to;
    if (inReplyTo !== undefined && !(typeof inReplyTo === 'string' && isMessageId(inReplyTo))) {
      refuse('invalid_request', 'in_reply_to must be a Message-ID in angle brackets');
    }
    const references = body.references ?? [];
    if (
      !Array.isArray(references) ||
      references.length > limit.MAX_REFERENCE_IDS ||
      !references.every((id) => typeof id === 'string' && isMessageId(id))
    ) {
      refuse('invalid_request', 'references must be Message-IDs in angle brackets');
    }
    const draftId = body.draft_id;
    if (draftId !== undefined && !(typeof draftId === 'string' && UUID_PATTERN.test(draftId))) {
      refuse('invalid_request', 'draft_id must be a UUID');
    }
    if (!isRecord(body.sent)) {
      refuse('invalid_request', 'sent must be the sealed copy for the sender');
    }
    if (!Array.isArray(body.copies) || body.copies.length === 0) {
      refuse('invalid_request', 'copies must list one copy per recipient');
    }
    if (body.copies.length > limit.MAX_INTERNAL_RECIPIENTS) {
      refuse('too_many_recipients');
    }
    const totals = new Totals();
    only(body.sent, SEALED_KEYS);
    const sent = sealedPart(body.sent, 'sent', totals);
    const copies = (body.copies as unknown[]).map((copy) => recipientCopy(copy, totals));
    return {
      ok: true,
      value: { to, cc, bcc, inReplyTo, references: references as string[], draftId, sent, copies }
    };
  } catch (error) {
    if (error instanceof Refusal) {
      return { ok: false, code: error.code, error: error.detail };
    }
    throw error;
  }
}

/** The request body as JSON, read in pieces so that it is never held whole beyond the cap. `json` is undefined when the body is not JSON. */
export async function readJsonLimited(request: Request, max: number): Promise<{ tooLarge: boolean; json: unknown; bytes: number }> {
  if (Number(request.headers.get('Content-Length') ?? 0) > max) {
    return { tooLarge: true, json: undefined, bytes: 0 };
  }
  const reader = request.body?.getReader();
  if (reader === undefined) {
    return { tooLarge: false, json: undefined, bytes: 0 };
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      return { tooLarge: true, json: undefined, bytes: total };
    }
    chunks.push(value);
  }
  const whole = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    whole.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return { tooLarge: false, json: JSON.parse(new TextDecoder().decode(whole)) as unknown, bytes: total };
  } catch {
    return { tooLarge: false, json: undefined, bytes: total };
  }
}
