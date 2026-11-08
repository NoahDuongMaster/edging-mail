import { assertKeyPair, deriveCredentials, fromBase64Url, parsePublicKey, unwrapPrivateKey } from '../../../shared/crypto/client';
import type { PublicKey } from '../../../shared/crypto/client';
import { apiGet } from '../api';
import { KeysOpenError } from './errors';
import { keepKey } from './keyStore';
import { rememberSharedDevice } from './sharedDevice';

/** The key bundle of a person (`keyBundle` of the Worker): everything the browser needs to open their private key, nothing secret. */
export interface KeyBundle {
  public_key: string;
  key_id: string;
  wrapped_private_key_pw: string;
  wrapped_private_key_recovery?: string;
  recovery_set_at?: number;
  /** Compare-and-set counter: every change of key material sends the version it read. */
  keys_version: number;
}

export interface RetiredKey {
  key_id: string;
  wrapped_private_key_recovery: string;
  retired_at: number;
  /** How many of the person's messages are sealed to this key (and so cannot be opened). */
  locked: number;
  /** When the person asked to delete them, and when the server will do it: both null when nothing is pending. */
  delete_requested_at: number | null;
  delete_after: number | null;
}

export interface MyKeys {
  keys: KeyBundle | null;
  retired: RetiredKey[];
}

export const fetchMyKeys = (): Promise<MyKeys> => apiGet<MyKeys>('/api/keys/me', 'fail.keys_load');

/**
 * The private key from the bundle and the key that wraps it, as a NON-extractable key checked against the public key. The public key comes
 * from the server, so a substituted or damaged key fails here, loudly, and not later as a mailbox of rows that will not open.
 */
export async function openKeyBundle(
  wrapKey: CryptoKey,
  email: string,
  bundle: KeyBundle
): Promise<{ pair: CryptoKeyPair; publicKey: PublicKey }> {
  try {
    const publicKey = await parsePublicKey(fromBase64Url(bundle.public_key));
    if (publicKey.keyId !== bundle.key_id) {
      throw new KeysOpenError();
    }
    const privateKey = await unwrapPrivateKey(wrapKey, fromBase64Url(bundle.wrapped_private_key_pw), email, bundle.key_id);
    await assertKeyPair(privateKey, publicKey);
    return { pair: { privateKey, publicKey: publicKey.key }, publicKey };
  } catch (error) {
    throw error instanceof KeysOpenError ? error : new KeysOpenError();
  }
}

/** Opens the bundle with the wrap key of the password that was just accepted and keeps the key in use (and stored, unless `persist` is false). */
export async function unlockWithWrapKey(
  wrapKey: CryptoKey,
  user: { id: string; email: string },
  bundle: KeyBundle,
  options: { persist: boolean }
): Promise<void> {
  const { pair, publicKey } = await openKeyBundle(wrapKey, user.email, bundle);
  await keepKey(user.id, pair, publicKey, options);
}

/** The unlock screen: the session is valid but this browser has no key (the page was reloaded on a shared device, or the stored key expired). */
export async function unlockWithPassword(
  user: { id: string; email: string },
  password: string,
  options: { persist: boolean }
): Promise<void> {
  const { keys } = await fetchMyKeys();
  if (keys === null) {
    throw new KeysOpenError();
  }
  const { wrapKey } = await deriveCredentials(password, user.email);
  await unlockWithWrapKey(wrapKey, user, keys, options);
  // The choice made on this screen is the one the next unlock of this tab starts with.
  rememberSharedDevice(!options.persist);
}
