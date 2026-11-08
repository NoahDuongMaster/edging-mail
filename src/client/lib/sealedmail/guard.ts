import type { SendHeaders } from './build';
import { SealedMailError } from './errors';
import { checkLimits } from './limits';
import { canonicalList } from './lookup';
import type { SendPlan } from './plan';
import type { MailContent, OutgoingAttachment } from './types';

/** What the person agreed to, address by address (the dialogs are built from `plan.needsConfirm`). */
export interface Confirmed {
  /** Internal people without keys: the server will read their copy. */
  noKeys: readonly string[];
  /** People whose key is not the one pinned. */
  changedKeys: readonly string[];
}

const notIn = (needed: readonly string[], given: readonly string[]): string[] => {
  const agreed = new Set(canonicalList(given));
  return needed.filter((address) => !agreed.has(address));
};

/** Refuses, before anything is sealed or sent, whatever the UI should have stopped: the wrong route, headers that are not the plan's, an unconfirmed address, a message over a cap. */
export function assertSendable(
  plan: SendPlan,
  headers: SendHeaders,
  confirmed: Confirmed,
  content: MailContent,
  attachments: readonly OutgoingAttachment[]
): void {
  if (plan.route !== 'internal') {
    throw new SealedMailError('not_internal');
  }
  const typed = canonicalList(headers.to, headers.cc, headers.bcc);
  const planned = new Set(plan.recipients.map((recipient) => recipient.address));
  if (typed.length !== planned.size || !typed.every((address) => planned.has(address))) {
    throw new SealedMailError('plan_mismatch');
  }
  const unconfirmed = [
    ...notIn(plan.needsConfirm.noKeys, confirmed.noKeys),
    ...notIn(plan.needsConfirm.changedKeys, confirmed.changedKeys)
  ];
  if (unconfirmed.length > 0) {
    throw new SealedMailError('confirm_needed', { addresses: unconfirmed });
  }
  const problems = checkLimits(content, attachments, plan.recipients.length, plan.copies.length);
  if (problems.length > 0) {
    throw new SealedMailError('too_big', { problems });
  }
}
