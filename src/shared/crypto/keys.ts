import { concat, toBase64Url, utf8 } from './bytes';
import type { Bytes } from './bytes';
import { splitBlob } from './blob';
import { FORMAT_VERSION, GCM_TAG_BYTES, IV_BYTES, LABEL, RECOVERY_KEY_BYTES } from './constants';
import { hkdf } from './hkdf';
import { canonicalAddress } from './kdf';
import { parsePublicKey } from './public-key';
import type { PublicKey } from './public-key';
import { assertKeyPair } from './open';
import { deriveRecoveryAuth } from './recovery-key';

// The user's key pair and its two wraps (crypto-design.md section 4). Browser entry only.

const P256 = { name: 'ECDH', namedCurve: 'P-256' } as const;

/** AAD of a wrapped private key: bound to the account and to the key it is, so a blob cannot be replayed for another. */
export const privateKeyAad = (address: string, keyId: string): Bytes =>
  utf8(`${LABEL.privateKeyAad}\0${canonicalAddress(address)}\0${keyId}`);

/**
 * A new ECDH P-256 pair. The private key is extractable ONLY so it can be wrapped once (key setup, re-wrap); after that the browser
 * works with the non-extractable key from `unwrapPrivateKey`.
 */
export async function generateUserKeyPair(): Promise<{ privateKey: CryptoKey; publicKey: PublicKey }> {
  const pair = await crypto.subtle.generateKey(P256, true, ['deriveBits']);
  const spki = new Uint8Array(await crypto.subtle.exportKey('spki', pair.publicKey));
  return { privateKey: pair.privateKey, publicKey: await parsePublicKey(spki) };
}

/** PKCS8 of the private key, encrypted under `wrapKey` (the password key or the recovery key): `0x01 || iv || ciphertext || tag`. */
export async function wrapPrivateKey(wrapKey: CryptoKey, privateKey: CryptoKey, address: string, keyId: string): Promise<Bytes> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const wrapped = new Uint8Array(
    await crypto.subtle.wrapKey('pkcs8', privateKey, wrapKey, {
      name: 'AES-GCM',
      iv,
      additionalData: privateKeyAad(address, keyId),
      tagLength: 128
    })
  );
  return concat(Uint8Array.of(FORMAT_VERSION), iv, wrapped);
}

/** The private key from a wrapped blob. `extractable` is false for everyday use: the key can compute but never be read out. */
export async function unwrapPrivateKey(
  wrapKey: CryptoKey,
  blob: Uint8Array,
  address: string,
  keyId: string,
  extractable = false
): Promise<CryptoKey> {
  const { iv, sealed } = splitBlob(blob, 1 + IV_BYTES + GCM_TAG_BYTES);
  return crypto.subtle.unwrapKey(
    'pkcs8',
    sealed,
    wrapKey,
    { name: 'AES-GCM', iv, additionalData: privateKeyAad(address, keyId), tagLength: 128 },
    P256,
    extractable,
    ['deriveBits']
  );
}

/** A fresh 32-byte recovery key. Shown once as text (recovery-key.ts); never sent or stored. */
export const generateRecoveryKey = (): Bytes => crypto.getRandomValues(new Uint8Array(RECOVERY_KEY_BYTES));

/** The AES key a recovery key gives: it wraps and unwraps the same private key as the password key does. */
export async function recoveryWrapKey(recoveryKey: Bytes): Promise<CryptoKey> {
  const raw = await hkdf(recoveryKey, utf8(LABEL.recoveryWrap), 32);
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['wrapKey', 'unwrapKey']);
}

/** What a key setup sends (all base64url) and keeps. */
export interface KeySet {
  upload: {
    public_key: string;
    key_id: string;
    wrapped_private_key_pw: string;
    wrapped_private_key_recovery: string;
    recovery_auth: string;
  };
  /** The NON-extractable key (unwrapped from the blob that was just made) and its public key: what the session works with. */
  pair: CryptoKeyPair;
  publicKey: PublicKey;
}

/**
 * Key setup in one call (the only place the extractable private key exists): a new pair, wrapped under the password key and under the
 * recovery key; then BOTH wraps are opened again with the same keys (non-extractable) and checked against the public key, so a request
 * that the browser could not open later is never sent. The caller keeps `pair` (not the extractable key, which is dropped here).
 */
export async function createKeySet(wrapKey: CryptoKey, recoveryKey: Bytes, address: string): Promise<KeySet> {
  const { privateKey, publicKey } = await generateUserKeyPair();
  const recoveryWrap = await recoveryWrapKey(recoveryKey);
  const wrappedPw = await wrapPrivateKey(wrapKey, privateKey, address, publicKey.keyId);
  const wrappedRecovery = await wrapPrivateKey(recoveryWrap, privateKey, address, publicKey.keyId);
  const viaPassword = await unwrapPrivateKey(wrapKey, wrappedPw, address, publicKey.keyId);
  const viaRecovery = await unwrapPrivateKey(recoveryWrap, wrappedRecovery, address, publicKey.keyId);
  await assertKeyPair(viaPassword, publicKey);
  await assertKeyPair(viaRecovery, publicKey);
  const recoveryAuth = await deriveRecoveryAuth(recoveryKey);
  return {
    upload: {
      public_key: toBase64Url(publicKey.spki),
      key_id: publicKey.keyId,
      wrapped_private_key_pw: toBase64Url(wrappedPw),
      wrapped_private_key_recovery: toBase64Url(wrappedRecovery),
      recovery_auth: recoveryAuth.text
    },
    pair: { privateKey: viaPassword, publicKey: publicKey.key },
    publicKey
  };
}
