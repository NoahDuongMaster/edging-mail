import { Aes256Gcm, CipherSuite, DhkemP256HkdfSha256, HkdfSha256 } from '@hpke/core';
import type { Bytes } from './bytes';

// HPKE (RFC 9180), base mode, DHKEM(P-256, HKDF-SHA256) / HKDF-SHA256 / AES-256-GCM, single-shot. This is the SEAL half: it needs only the
// recipient's PUBLIC key, which is all the Worker ever holds. The open half is hpke-open.ts and is part of the browser entry only.
// The library's CipherSuite class also contains its own recipient code; nothing in this folder reaches it from here (see the
// bundle check, scripts/check-worker-bundle.mjs).

export const hpkeSuite = (): CipherSuite =>
  new CipherSuite({ kem: new DhkemP256HkdfSha256(), kdf: new HkdfSha256(), aead: new Aes256Gcm() });

/** Encrypts `plaintext` to `recipient` with a fresh ephemeral key: two seals of the same input never match. */
export async function hpkeSeal(recipient: CryptoKey, info: Bytes, aad: Bytes, plaintext: Bytes): Promise<{ enc: Bytes; ct: Bytes }> {
  const context = await hpkeSuite().createSenderContext({ recipientPublicKey: recipient, info });
  const ct = new Uint8Array(await context.seal(plaintext, aad));
  return { enc: new Uint8Array(context.enc), ct };
}
