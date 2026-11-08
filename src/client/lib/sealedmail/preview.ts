import { canonicalList } from './lookup';
import { BLOB_OVERHEAD, LIMITS } from './limits';
import type { KeyAnswer } from './types';

// The quiet line under the recipient fields (EC-4): what THIS message will be, from the same lookup the send uses, before the send. It mirrors the
// decisions of `runSend` (flow.ts) without asking anything: a message to somebody outside this deployment or without keys, or too big for the end-to-end route, goes the usual way;
// everything else is sealed in the browser. There is no case for another From address: `/send` refuses one (403 `from_not_allowed`), so the person
// cannot reach that state and gets an error, not a silent downgrade.

export type PreviewReason = 'outside' | 'no_keys' | 'big';

export type Preview =
  /** Nothing to say yet: no recipient, an answer still missing, or the lookup did not work (the send asks again anyway). */
  { state: 'unknown' } | { state: 'e2e' } | { state: 'plain'; reason: PreviewReason };

/** The worker's rule for one plain address: only a finished one is asked about, never half of what is being typed. */
export const isCompleteAddress = (value: string): boolean => /^[^\s@<>,"]+@[^\s@<>,"]+\.[^\s@<>,"]+$/.test(value);

/** Lower-cased, distinct, finished addresses of the three recipient lists. */
export const previewAddresses = (...lists: readonly (readonly string[])[]): string[] => canonicalList(...lists).filter(isCompleteAddress);

/** One lookup answers at most this many addresses; more recipients than the end-to-end route takes are not previewed (the send says what it needs). */
const MAX_PREVIEW_ADDRESSES = LIMITS.recipients;

/**
 * The addresses to ask the server about now: the ones with no answer yet, unless the preview already used its share of the lookup budget
 * (`/api/keys/lookup` allows 60 calls per 15 minutes for everything the person does, the send included) or the list is too long to ask.
 */
export function addressesToAsk(
  wanted: readonly string[],
  answered: ReadonlySet<string>,
  lookupsDone: number,
  maxLookups: number
): string[] {
  if (wanted.length === 0 || wanted.length > MAX_PREVIEW_ADDRESSES || lookupsDone >= maxLookups) {
    return [];
  }
  return wanted.filter((address) => !answered.has(address));
}

interface PreviewInput {
  addresses: readonly string[];
  /** What the lookup said, by address (lower-cased). */
  answers: ReadonlyMap<string, KeyAnswer>;
  /** The size in bytes of every attached file. */
  fileSizes: readonly number[];
}

/** Does the message still fit the end-to-end route with these files? Every person gets a sealed copy of every file, and the Sent copy is one more. */
function filesFit(fileSizes: readonly number[], people: number): boolean {
  const copies = people + 1;
  const sealed = copies * fileSizes.reduce((total, size) => total + size + BLOB_OVERHEAD, 0);
  return (
    fileSizes.length <= LIMITS.attachmentsPerCopy &&
    copies * fileSizes.length <= LIMITS.attachmentObjects &&
    sealed <= LIMITS.attachmentBytes
  );
}

export function previewOf(input: PreviewInput): Preview {
  const addresses = canonicalList(input.addresses);
  if (addresses.length === 0 || addresses.length > MAX_PREVIEW_ADDRESSES) {
    return { state: 'unknown' };
  }
  const found = addresses.map((address) => input.answers.get(address));
  if (found.includes(undefined)) {
    return { state: 'unknown' };
  }
  if (found.some((answer) => answer?.internal !== true)) {
    return { state: 'plain', reason: 'outside' };
  }
  if (found.some((answer) => answer?.publicKey === undefined)) {
    return { state: 'plain', reason: 'no_keys' };
  }
  return filesFit(input.fileSizes, addresses.length) ? { state: 'e2e' } : { state: 'plain', reason: 'big' };
}
