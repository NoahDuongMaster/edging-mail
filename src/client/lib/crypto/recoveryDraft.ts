import {
  assertKeyPair,
  confirmationMatches,
  createKeySet,
  deriveRecoveryAuth,
  drawConfirmationGroups,
  encodeRecoveryKey,
  fromBase64Url,
  generateRecoveryKey,
  recoveryWrapKey,
  toBase64Url,
  unwrapPrivateKey,
  wrapPrivateKey
} from '../../../shared/crypto/client';
import type { Bytes, KeySet, PublicKey } from '../../../shared/crypto/client';

/**
 * A NEW recovery key, from the moment it is made until the person has typed back three of its groups and the request that stores its proof
 * has gone. The 32 bytes live here, in this object, and nowhere else: not in React state, not in a store, not in storage. The text form is
 * handed to the one screen that shows it; `discard()` zeroes the bytes and the screen calls it when it unmounts.
 */
export class RecoveryKeyDraft {
  readonly text: string;
  /** The nine groups of six symbols, for display. */
  readonly groups: readonly string[];
  private key: Bytes | null;

  private constructor(key: Bytes, text: string) {
    this.key = key;
    this.text = text;
    this.groups = text.split('-');
  }

  static async create(): Promise<RecoveryKeyDraft> {
    const key = generateRecoveryKey();
    return new RecoveryKeyDraft(key, await encodeRecoveryKey(key));
  }

  private bytes(): Bytes {
    if (this.key === null) {
      throw new Error('this recovery key was discarded');
    }
    return this.key;
  }

  /** Key setup: a new key pair wrapped under the password key AND this recovery key, both wraps re-opened and checked (createKeySet). */
  keySet(wrapKey: CryptoKey, address: string): Promise<KeySet> {
    return createKeySet(wrapKey, this.bytes(), address);
  }

  /** The proof of possession the server stores a verifier of (`recovery_auth`). Not the key, and it reveals nothing about the key's wrap. */
  async proof(): Promise<string> {
    const { text } = await deriveRecoveryAuth(this.bytes());
    return text;
  }

  /** An already unwrapped private key (extractable, held only by the caller's function) wrapped under this recovery key: base64url. */
  async wrap(privateKey: CryptoKey, address: string, keyId: string): Promise<string> {
    return toBase64Url(await wrapPrivateKey(await recoveryWrapKey(this.bytes()), privateKey, address, keyId));
  }

  /** Re-opens a wrap made by `wrap` with this key and checks it against the public key: a request the browser could not open later is never sent. */
  async opens(wrapped: string, address: string, keyId: string, publicKey: PublicKey): Promise<void> {
    await assertKeyPair(await unwrapPrivateKey(await recoveryWrapKey(this.bytes()), fromBase64Url(wrapped), address, keyId), publicKey);
  }

  discard(): void {
    this.key?.fill(0);
    this.key = null;
  }
}

/** Which three groups (numbered from 1) the person must type back, and the check. A new draw for every attempt. */
export interface ConfirmationChallenge {
  /** 1-based group numbers, ascending, never two neighbours. */
  numbers: readonly [number, number, number];
  matches: (typed: readonly string[]) => boolean;
}

export function drawChallenge(text: string): ConfirmationChallenge {
  const indexes = drawConfirmationGroups();
  return {
    numbers: [indexes[0] + 1, indexes[1] + 1, indexes[2] + 1],
    matches: (typed) => confirmationMatches(text, indexes, typed)
  };
}
