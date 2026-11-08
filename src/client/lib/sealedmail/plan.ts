import { fromBase64Url } from '../../../shared/crypto/client';
import { getUnlockedKey } from '../crypto/keyStore';
import { SealedMailError } from './errors';
import { fingerprintOf } from './fingerprint';
import { canonicalList } from './lookup';
import { acceptChange, pin } from './pins';
import type { PinCheck, PinState } from './pins';
import type { KeyAnswer, LookupMap } from './types';

/** `ready`: has keys, the copy is sealed to them. `no_keys`: an internal person who never signed in (the server must read their copy). `external`: outside this deployment. */
export type PlanState = 'ready' | 'no_keys' | 'external';

export interface PlanRecipient {
  /** Lower-cased and trimmed. */
  address: string;
  state: PlanState;
  /** Only meaningful when `state` is 'ready' (otherwise 'new', or 'was_keyed' for an address that had a pinned key and now has none). */
  pin: PinState;
  keyId?: string;
  /** The public key (SPKI, base64url) the copy is sealed to. */
  publicKey?: string;
  /** Six groups of five digits (see fingerprint.ts). */
  fingerprint?: string;
  /** When `pin` is 'changed': the key that was pinned before. */
  previousKeyId?: string;
  previousFingerprint?: string;
}

/** One copy the send makes for one person. A person with keys is one copy even when they were addressed twice (an alias): same key id. */
export type PlanCopy =
  { kind: 'sealed'; address: string; addresses: string[]; keyId: string; publicKey: string } | { kind: 'plain'; address: string };

/** All that the confirmation dialogs need, as data; the dialogs write the words. */
export interface SendPlan {
  /** `internal` only when EVERY address is on this deployment (contract section 1): else the normal send route. */
  route: 'internal' | 'external';
  recipients: PlanRecipient[];
  /** True only when every recipient is `ready`: nothing but the sender's and the recipients' browsers will ever see the content. */
  e2e: boolean;
  /**
   * Addresses to confirm before an internal send (`noKeys`, `changedKeys`: empty for the external route, where nothing is sealed to anybody),
   * and, on either route, the addresses that had a pinned key and now have none (`wasKeyed`, EC-2: a downgrade the person is told about).
   */
  needsConfirm: { noKeys: string[]; changedKeys: string[]; wasKeyed: string[] };
  /** Empty for the external route. */
  copies: PlanCopy[];
}

async function recipientOf(address: string, answer: KeyAnswer | undefined, check: PinCheck | undefined): Promise<PlanRecipient> {
  // An address with a pin and no key in the answer: the person had keys before.
  const pinState: PinState = check?.state === 'was_keyed' ? 'was_keyed' : 'new';
  if (answer?.internal !== true) {
    return { address, state: 'external', pin: pinState };
  }
  if (answer.publicKey === undefined || answer.keyId === undefined) {
    return { address, state: 'no_keys', pin: pinState };
  }
  const recipient: PlanRecipient = {
    address,
    state: 'ready',
    pin: check?.state ?? 'new',
    keyId: answer.keyId,
    publicKey: answer.publicKey,
    fingerprint: await fingerprintOf(fromBase64Url(answer.publicKey))
  };
  if (recipient.pin === 'changed' && check?.pinned) {
    recipient.previousKeyId = check.pinned.keyId;
    recipient.previousFingerprint = await fingerprintOf(fromBase64Url(check.pinned.spki));
  }
  return recipient;
}

/** One sealed copy per key id (a person), one plain copy per keyless address. Two aliases of one keyless person: see `send.ts`. */
function copiesOf(recipients: readonly PlanRecipient[]): PlanCopy[] {
  const copies: PlanCopy[] = [];
  const byKey = new Map<string, Extract<PlanCopy, { kind: 'sealed' }>>();
  for (const { address, state, keyId, publicKey } of recipients) {
    if (state === 'no_keys') {
      copies.push({ kind: 'plain', address });
    } else if (state === 'ready' && keyId !== undefined && publicKey !== undefined) {
      const group = byKey.get(keyId);
      if (group === undefined) {
        const created = { kind: 'sealed' as const, address, addresses: [address], keyId, publicKey };
        byKey.set(keyId, created);
        copies.push(created);
      } else {
        group.addresses.push(address);
      }
    }
  }
  return copies;
}

/** What sending to these people would do: route, who is ready, who needs a confirmation, and the copies. `pins` is `compareWithPins` of the same lookup. */
export async function planSend(
  headers: { to: readonly string[]; cc: readonly string[]; bcc: readonly string[] },
  lookup: LookupMap,
  pins: ReadonlyMap<string, PinCheck>
): Promise<SendPlan> {
  const addresses = canonicalList(headers.to, headers.cc, headers.bcc);
  const recipients = await Promise.all(addresses.map((address) => recipientOf(address, lookup.get(address), pins.get(address))));
  const internal = recipients.length > 0 && recipients.every((recipient) => recipient.state !== 'external');
  const noKeys = internal ? recipients.filter((recipient) => recipient.state === 'no_keys').map((recipient) => recipient.address) : [];
  const changedKeys = internal ? recipients.filter((recipient) => recipient.pin === 'changed').map((recipient) => recipient.address) : [];
  const wasKeyed = recipients.filter((recipient) => recipient.pin === 'was_keyed').map((recipient) => recipient.address);
  return {
    route: internal ? 'internal' : 'external',
    recipients,
    e2e: internal && recipients.every((recipient) => recipient.state === 'ready'),
    needsConfirm: { noKeys, changedKeys, wasKeyed },
    copies: internal ? copiesOf(recipients) : []
  };
}

/** The person accepted the new keys of these addresses (those of the plan that are `changed`): they replace the pinned ones. Plan again afterwards. */
export function acceptChanges(plan: SendPlan, addresses: readonly string[]): void {
  const me = getUnlockedKey();
  if (me === null) {
    throw new SealedMailError('locked');
  }
  const accepted = new Set(canonicalList(addresses));
  for (const { address, pin: state, keyId, publicKey } of plan.recipients) {
    if (accepted.has(address) && state === 'changed' && keyId !== undefined && publicKey !== undefined) {
      acceptChange(me.userId, address, { keyId, spki: publicKey, firstSeen: Date.now() });
    }
  }
}

/** After a successful send: pins the `new` keys (trust on first use) and, for a change the person confirmed in the same step, the new key. */
export function rememberKeys(userId: string, plan: SendPlan, confirmedChanges: readonly string[]): void {
  const confirmed = new Set(canonicalList(confirmedChanges));
  for (const { address, state, pin: pinState, keyId, publicKey } of plan.recipients) {
    if (state !== 'ready' || keyId === undefined || publicKey === undefined) {
      continue;
    }
    const entry = { keyId, spki: publicKey, firstSeen: Date.now() };
    if (pinState === 'new') {
      pin(userId, address, entry);
    } else if (pinState === 'changed' && confirmed.has(address)) {
      acceptChange(userId, address, entry);
    }
  }
}
