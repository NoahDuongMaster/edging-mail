import { fromBase64Url, parsePublicKey } from '../../../shared/crypto/client';
import type { PublicKey } from '../../../shared/crypto/client';
import { SealedMailError } from './errors';
import { plainCopy, sealCopy } from './seal';
import type { PlanCopy, SendPlan } from './plan';
import type { MailContent, OutgoingAttachment, PlainCopy, Sealed, SealedCopy } from './types';

/** Every copy of one send, built (sealed) before anything is posted. */
export interface Built {
  /** The sender's own Sent copy, sealed to the unlocked key. */
  sent: Sealed;
  /** One per person with keys. */
  sealed: SealedCopy[];
  /** One per confirmed keyless address (plaintext for the server to seal). */
  plain: PlainCopy[];
}

async function keyOf(copy: Extract<PlanCopy, { kind: 'sealed' }>): Promise<PublicKey> {
  try {
    const key = await parsePublicKey(fromBase64Url(copy.publicKey));
    // The plan came from a lookup that was checked, but a copy sealed to a key other than the one named would simply be unreadable.
    if (key.keyId === copy.keyId) {
      return key;
    }
  } catch {
    // Not a key: the same refusal as a key with another id.
  }
  throw new SealedMailError('bad_answer');
}

async function sealToPerson(
  copy: Extract<PlanCopy, { kind: 'sealed' }>,
  content: MailContent,
  attachments: readonly OutgoingAttachment[]
): Promise<SealedCopy> {
  return { address: copy.address, ...(await sealCopy(content, attachments, await keyOf(copy))) };
}

export async function buildCopies(
  content: MailContent,
  attachments: readonly OutgoingAttachment[],
  plan: SendPlan,
  own: PublicKey
): Promise<Built> {
  const [sent, sealed] = await Promise.all([
    sealCopy(content, attachments, own),
    Promise.all(plan.copies.flatMap((copy) => (copy.kind === 'sealed' ? [sealToPerson(copy, content, attachments)] : [])))
  ]);
  const plain = plan.copies.flatMap((copy) => (copy.kind === 'plain' ? [plainCopy(copy.address, content, attachments)] : []));
  return { sent, sealed, plain };
}

export interface SendHeaders {
  to: readonly string[];
  cc: readonly string[];
  bcc: readonly string[];
  in_reply_to?: string;
  references?: readonly string[];
  draft_id?: string;
}

const typed = (list: readonly string[]): string[] => list.map((address) => address.trim()).filter((address) => address !== '');

/** The JSON of `POST /api/messages/internal`: headers as typed, the Sent copy and one copy per person. */
export function requestBody(headers: SendHeaders, built: Built, plain: readonly PlainCopy[]): string {
  return JSON.stringify({
    to: typed(headers.to),
    cc: typed(headers.cc),
    bcc: typed(headers.bcc),
    ...(headers.in_reply_to === undefined ? {} : { in_reply_to: headers.in_reply_to }),
    ...(headers.references === undefined || headers.references.length === 0 ? {} : { references: headers.references }),
    ...(headers.draft_id === undefined ? {} : { draft_id: headers.draft_id }),
    sent: built.sent,
    copies: [...built.sealed, ...plain]
  });
}
