import { decodeCanonical, parsePublicKey } from '../../shared/crypto/server';
import type { Recipient } from './seal';

/** The key a user's mail is sealed to, from `users.public_key`. undefined when there is none, or the stored value is damaged (fail closed). */
export async function userRecipient(publicKey: string | null): Promise<Extract<Recipient, { kind: 'user' }> | undefined> {
  const spki = publicKey === null ? null : decodeCanonical(publicKey);
  if (spki === null) {
    return undefined;
  }
  try {
    return { kind: 'user', key: await parsePublicKey(spki) };
  } catch {
    return undefined;
  }
}
