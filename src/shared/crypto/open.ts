import { CryptoFormatError, CryptoOpenError, equalBytes, toBase64Url } from './bytes';
import type { Bytes } from './bytes';
import { splitBlob } from './blob';
import { CEK_BYTES, GCM_TAG_BYTES, IV_BYTES } from './constants';
import { blobAad, cekAad, cekInfo, contentKey, newCek, parseWrappedCek, sealCek } from './envelope';
import type { PublicKey } from './public-key';
import { hpkeOpen } from './hpke-open';

// Opening side: browser entry only.

/** Decrypts one `0x01 || iv || ciphertext || tag` blob. Any failure (key, AAD, altered byte) is the same CryptoOpenError. */
export async function openBlob(key: CryptoKey, aad: Bytes, blob: Uint8Array): Promise<Bytes> {
  const { iv, sealed } = splitBlob(blob, 1 + IV_BYTES + GCM_TAG_BYTES);
  try {
    return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: aad, tagLength: 128 }, key, sealed));
  } catch {
    throw new CryptoOpenError();
  }
}

/** Decrypts one field of a message (the purpose and the row id are part of what is authenticated). */
export async function openField(cek: Bytes, purpose: string, rowId: string, blob: Uint8Array): Promise<Bytes> {
  const key = await contentKey(cek, purpose, 'decrypt');
  // Awaited here (not returned): a rejection of openBlob is handled in the same tick it happens, so no runtime reports it as unhandled.
  const plain = await openBlob(key, blobAad(purpose, rowId), blob);
  return plain;
}

/**
 * The CEK of a message row from its `wrapped_cek`. `keyId` is the column value (base64url text); the raw id in the blob header must
 * equal it, so a blob cannot be presented under another key's name. `recipient` is the user's non-extractable private key TOGETHER with
 * their public key (see hpke-open.ts for why both).
 */
export async function unwrapCek(wrapped: Uint8Array, rowId: string, keyId: string, recipient: CryptoKeyPair): Promise<Bytes> {
  const parsed = parseWrappedCek(wrapped);
  if (toBase64Url(parsed.keyIdRaw) !== keyId) {
    throw new CryptoFormatError('The key id in the wrapped key does not match the row');
  }
  const cek = await hpkeOpen(recipient, parsed.enc, cekInfo(), cekAad(rowId, keyId), parsed.ct);
  if (cek.length !== CEK_BYTES) {
    throw new CryptoFormatError('A content key is 32 bytes');
  }
  return cek;
}

/**
 * Proves a private key and a public key belong together: seals a fresh content key to the public key and opens it with the pair. The
 * public key comes from the server, so this runs at unlock, in the key-setup self-test and in the forgot-flow self-test; a substituted
 * or wrong key fails here, loudly, and not later as a mailbox of rows that will not open.
 */
export async function assertKeyPair(privateKey: CryptoKey, publicKey: PublicKey): Promise<void> {
  const cek = newCek();
  const rowId = crypto.randomUUID();
  const opened = await unwrapCek(await sealCek(cek, rowId, publicKey), rowId, publicKey.keyId, { privateKey, publicKey: publicKey.key });
  if (!equalBytes(opened, cek)) {
    throw new CryptoFormatError('The private key does not belong to the public key');
  }
}
