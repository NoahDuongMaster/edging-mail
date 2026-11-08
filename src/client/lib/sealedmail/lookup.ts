import { canonicalAddress, decodeCanonical, parsePublicKey } from '../../../shared/crypto/client';
import { SealedMailError } from './errors';
import { isRecord } from './helpers';
import { LIMITS } from './limits';
import { browserFetch, failureOf, postJson, succeeded } from './request';
import type { Fetcher } from './request';
import type { KeyAnswer, LookupMap } from './types';

// POST /api/keys/lookup (src/worker/auth/key-routes.ts). The server trims, lower-cases and de-duplicates what it is asked, answers once per
// address in that order with the address AS ASKED (a `+tag` stays: the server resolves aliases and tags itself), and says `internal: true`
// with `public_key` and `key_id` for a person with keys, `internal: true` without them for a person who never signed in, `internal: false` else.

/** Trimmed, lower-cased, distinct, in order of first appearance; blanks dropped. */
export function canonicalList(...lists: readonly (readonly string[])[]): string[] {
  const seen = new Set<string>();
  for (const list of lists) {
    for (const raw of list) {
      const address = raw.trim().toLowerCase();
      if (address !== '') {
        seen.add(address);
      }
    }
  }
  return [...seen];
}

/** An address the key derivation accepts (printable ASCII, one `@`): every account with keys has such a primary address. Anything else is not asked. */
function askable(address: string): boolean {
  try {
    canonicalAddress(address);
    return true;
  } catch {
    return false;
  }
}

const refuse = (): never => {
  throw new SealedMailError('bad_answer');
};

async function readEntry(item: unknown): Promise<[string, KeyAnswer]> {
  if (!isRecord(item) || typeof item.address !== 'string' || typeof item.internal !== 'boolean') {
    return refuse();
  }
  const { address, internal, public_key: key, key_id: keyId } = item;
  if (!internal) {
    return key === undefined && keyId === undefined ? [address, { internal: false }] : refuse();
  }
  if (key === undefined && keyId === undefined) {
    return [address, { internal: true }];
  }
  const spki = decodeCanonical(key);
  if (typeof key !== 'string' || typeof keyId !== 'string' || spki === null) {
    return refuse();
  }
  // The key id is the hash of the key: a server that says another one would have mail sealed to a key its owner cannot name.
  const parsed = await parsePublicKey(spki).catch(() => refuse());
  return parsed.keyId === keyId ? [address, { internal: true, publicKey: key, keyId }] : refuse();
}

/** Checks a lookup answer strictly: exactly the addresses asked, once each, each entry well formed, every key a real P-256 key with its own id. */
export async function parseAnswers(value: unknown, asked: readonly string[]): Promise<LookupMap> {
  if (!Array.isArray(value) || value.length !== asked.length) {
    return refuse();
  }
  // The lengths match and every address asked is there, so there is nothing else in the answer.
  const read = new Map(await Promise.all((value as unknown[]).map((item) => readEntry(item))));
  const answers: LookupMap = new Map();
  for (const address of asked) {
    const answer = read.get(address);
    if (answer === undefined) {
      return refuse();
    }
    answers.set(address, answer);
  }
  return answers;
}

/**
 * The keys of the people behind `addresses` (at most 50 distinct). The map is keyed by the address as typed, lower-cased. A 429 comes out as the
 * ApiError of lib/api.ts with `retryAfter`. It does not need the unlocked key: it only reads public information.
 */
export async function lookupKeys(addresses: readonly string[], fetcher: Fetcher = browserFetch): Promise<LookupMap> {
  const all = canonicalList(addresses);
  if (all.length > LIMITS.recipients) {
    throw new SealedMailError('too_many_addresses');
  }
  const asked = all.filter((address) => askable(address));
  const answers: LookupMap = new Map();
  if (asked.length > 0) {
    const answer = await postJson('/api/keys/lookup', { addresses: asked }, fetcher);
    if (!succeeded(answer)) {
      throw failureOf(answer, 'fail.sealed_lookup');
    }
    for (const [address, entry] of await parseAnswers(answer.data.keys, asked)) {
      answers.set(address, entry);
    }
  }
  // Not asked (not an address a person here can have): outside, without a question.
  return new Map(all.map((address) => [address, answers.get(address) ?? { internal: false }]));
}
