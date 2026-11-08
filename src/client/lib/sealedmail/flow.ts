import type { Message } from '../../types';
import { ApiError } from '../api';
import { getUnlockedKey } from '../crypto/keyStore';
import { SealedMailError } from './errors';
import { checkLimits } from './limits';
import { canonicalList, lookupKeys } from './lookup';
import { externalReplyWarning } from './n6';
import { compareWithPins, markGone } from './pins';
import type { PinCheck } from './pins';
import { planSend } from './plan';
import type { PlanRecipient, SendPlan } from './plan';
import type { Fetcher } from './request';
import { sendInternal } from './send';
import type { SendHeaders, SendResult } from './send';
import type { LookupMap, MailContent, OutgoingAttachment } from './types';

// The whole decision of a send, in the order of reports/e2e-contract.md section 1 and crypto-review CK-1 / N6 / S3, without any screen: the
// screen answers the `Question`s and acts on the result. Nothing here ever sends content in the clear: the usual route (`normal`) is the
// caller's, and it is only advised when the person agreed, or when nothing is sealed to anybody anyway.

/** What the person has to decide. The screen writes the words from this data. */
export type Question =
  /** CK-1: these people never signed in; the server reads their copy until they do. */
  | { kind: 'no_keys'; addresses: string[]; inline: boolean }
  /** EC-2: these people had a pinned key, and the lookup now says they have none (or are not on this server): the server can read the message, or it leaves as normal email. */
  | { kind: 'was_keyed'; addresses: string[] }
  /** S3: the key of these people is not the one pinned before (fingerprints inside). */
  | { kind: 'changed'; recipients: PlanRecipient[] }
  /** N6: an end-to-end message is answered or forwarded to these outside addresses, in the clear. */
  | { kind: 'external'; addresses: string[] }
  /** The message is over a cap of the end-to-end route: the usual route reads it on the server. */
  | { kind: 'too_big' };

export type Ask = (question: Question) => Promise<boolean>;

export interface FlowInput {
  /** The From field as the person left it; the end-to-end route sends from the account's own address only (the server sets it). */
  sender: string;
  /** The signed-in account's own address. */
  primary: string;
  headers: SendHeaders;
  content: MailContent;
  attachments: readonly OutgoingAttachment[];
  /** The message being answered or forwarded was end-to-end (`is_e2e`): N6. */
  sourceIsE2E: boolean;
}

export type FlowResult =
  /** Sent end to end (or, with `e2e: false`, with a confirmed plain copy for someone without keys). Nothing more to do but to close. */
  | { status: 'sent'; e2e: boolean; message: Message | null }
  /** Use the usual `POST /api/messages/send` (nothing was sent yet; every question it needed was answered yes). */
  | { status: 'normal' }
  | { status: 'cancelled' };

const MAX_ROUNDS = 3;

const unasked = (left: readonly string[], right: ReadonlySet<string>): string[] => left.filter((address) => !right.has(address));

const CAP_CODES = new Set(['invalid_request', 'payload_too_large', 'too_many_recipients']);

/** A cap of the end-to-end route the pre-check did not catch (or a platform limit): 413, or a 400 about the shape or the number of recipients. Nothing is stored then. */
function isCapRefusal(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 413 || (error.status === 400 && CAP_CODES.has(error.code ?? '')));
}

export async function runSend(input: FlowInput, ask: Ask, fetcher?: Fetcher): Promise<FlowResult> {
  const { headers, content, attachments } = input;
  const all = canonicalList(headers.to, headers.cc, headers.bcc);
  let lookup: LookupMap;
  try {
    lookup = await lookupKeys(all, fetcher);
  } catch (error) {
    if (error instanceof SealedMailError && error.reason === 'too_many_addresses') {
      // Over what the end-to-end route takes: the usual route, and N6 cannot tell who is outside, so an end-to-end source asks about all.
      return input.sourceIsE2E && !(await ask({ kind: 'external', addresses: all })) ? { status: 'cancelled' } : { status: 'normal' };
    }
    throw error;
  }

  // Answered yes already (a retry after a key_changed answer does not ask the same question twice).
  const okNoKeys = new Set<string>();
  const okWasKeyed = new Set<string>();
  const okChanged = new Map<string, string>();
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const key = getUnlockedKey();
    const pins = key === null ? new Map<string, PinCheck>() : compareWithPins(key.userId, lookup);
    const plan: SendPlan = await planSend(headers, lookup, pins);

    // EC-2: somebody this browser sent encrypted mail to now has no keys (or is not on this server): said before anything else, on either
    // route, because a server that wants the plaintext does not need to swap a key. Their "no keys" question is covered by this one.
    const askWasKeyed = unasked(plan.needsConfirm.wasKeyed, okWasKeyed);
    if (askWasKeyed.length > 0 && !(await ask({ kind: 'was_keyed', addresses: askWasKeyed }))) {
      return { status: 'cancelled' };
    }
    for (const address of askWasKeyed) {
      okWasKeyed.add(address);
      okNoKeys.add(address);
      // EC-9: confirmed for an address that is outside this server now: not asked again until a key shows up (the pin stays, S3).
      if (key !== null && lookup.get(address)?.internal === false) {
        markGone(key.userId, address);
      }
    }

    if (plan.route === 'external') {
      const { warn, externalAddresses } = externalReplyWarning({ messageIsE2E: input.sourceIsE2E, plan });
      return warn && !(await ask({ kind: 'external', addresses: externalAddresses })) ? { status: 'cancelled' } : { status: 'normal' };
    }
    if (input.sender.trim().toLowerCase() !== input.primary.trim().toLowerCase()) {
      // The end-to-end route sends from the account's own address only: another From goes the usual way, where `/send` refuses it (403
      // `from_not_allowed`) and the person sees that error; it never becomes a quiet downgrade.
      return { status: 'normal' };
    }
    if (key === null) {
      throw new SealedMailError('locked');
    }
    if (checkLimits(content, attachments, plan.recipients.length, plan.copies.length).length > 0) {
      return (await ask({ kind: 'too_big' })) ? { status: 'normal' } : { status: 'cancelled' };
    }

    const noKeys = plan.needsConfirm.noKeys;
    const askNoKeys = unasked(noKeys, okNoKeys);
    // A copy in the clear has no place for an inline image (its content id is dropped): the person is told with the question.
    const inline = attachments.some((file) => file.contentId !== null);
    if (askNoKeys.length > 0 && !(await ask({ kind: 'no_keys', addresses: askNoKeys, inline }))) {
      return { status: 'cancelled' };
    }
    for (const address of noKeys) {
      okNoKeys.add(address);
    }
    const askChanged = plan.recipients.filter(
      (recipient) => plan.needsConfirm.changedKeys.includes(recipient.address) && okChanged.get(recipient.address) !== recipient.keyId
    );
    if (askChanged.length > 0 && !(await ask({ kind: 'changed', recipients: askChanged }))) {
      return { status: 'cancelled' };
    }
    for (const recipient of askChanged) {
      okChanged.set(recipient.address, recipient.keyId ?? '');
    }

    let result: SendResult;
    try {
      result = await sendInternal({ content, attachments, headers, plan, confirmed: plan.needsConfirm, fetcher });
    } catch (error) {
      if (isCapRefusal(error)) {
        // The server's caps are the final word: the same question as for a message the pre-check found too big. Nothing was stored.
        return (await ask({ kind: 'too_big' })) ? { status: 'normal' } : { status: 'cancelled' };
      }
      throw error;
    }
    if (result.status === 'sent') {
      return { status: 'sent', e2e: result.e2e, message: result.message };
    }
    if (result.ownKeyChanged) {
      // The keys of this person changed elsewhere while this browser still holds the old private key: it must unlock again first.
      throw new SealedMailError('locked');
    }
    // A key changed while the person wrote: nothing was stored. Plan again with the server's fresh keys; the pin check decides what is asked.
    lookup = result.keys;
  }
  throw new SealedMailError('bad_answer');
}
