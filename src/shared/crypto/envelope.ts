import { concat, CryptoFormatError, isUuid, utf8 } from './bytes';
import type { Bytes } from './bytes';
import { sealBlob } from './blob';
import {
  CEK_BYTES,
  FORMAT_VERSION,
  GCM_TAG_BYTES,
  HPKE_SUITE_BASE,
  KEY_ID_BYTES,
  LABEL,
  P256_POINT_BYTES,
  WRAPPED_CEK_BYTES
} from './constants';
import { hkdf } from './hkdf';
import { hpkeSeal } from './hpke-seal';
import type { PublicKey } from './public-key';

// EM1, the message envelope (crypto-design.md section 5, canonical encodings in 13.2). Per message row (and per draft save) a random
// 32-byte CEK; each field is an AES-256-GCM blob under a key derived from the CEK for that field's PURPOSE, bound to the row id; the CEK is
// HPKE-sealed to the owner's public key. All text in AAD and `info` is UTF-8 joined by a single 0x00, with no length prefixes.

const PURPOSE = /^(?:summary|body|raw|att-meta\/[\da-f-]{36}|att\/[\da-f-]{36})$/;

/** `purpose` of a content blob: summary, body, raw, `att-meta/<attachment id>` or `att/<attachment id>`. Anything else is refused. */
export function checkPurpose(purpose: string): string {
  if (!PURPOSE.test(purpose) || (purpose.includes('/') && !isUuid(purpose.slice(purpose.indexOf('/') + 1)))) {
    throw new CryptoFormatError('Unknown blob purpose');
  }
  return purpose;
}

export function checkRowId(rowId: string): string {
  if (!isUuid(rowId)) {
    throw new CryptoFormatError('A row id must be a lower-case UUID');
  }
  return rowId;
}

/** A fresh random content-encryption key. Never reused for a second save: a draft autosave makes a new one every time. */
export const newCek = (): Bytes => crypto.getRandomValues(new Uint8Array(CEK_BYTES));

export const blobAad = (purpose: string, rowId: string): Bytes => utf8(`${LABEL.blobAad}\0${checkPurpose(purpose)}\0${checkRowId(rowId)}`);

/** The AES-256-GCM key of one field, derived from the CEK; the purpose is part of the derivation, so fields do not share keys. */
export async function contentKey(cek: Bytes, purpose: string, usage: 'encrypt' | 'decrypt'): Promise<CryptoKey> {
  const raw = await hkdf(cek, utf8(`${LABEL.blobKey}${checkPurpose(purpose)}`), CEK_BYTES);
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, [usage]);
}

/** Encrypts one field of a message: `0x01 || iv || ciphertext || tag`. */
export async function sealField(cek: Bytes, purpose: string, rowId: string, plaintext: Bytes): Promise<Bytes> {
  return sealBlob(await contentKey(cek, purpose, 'encrypt'), blobAad(purpose, rowId), plaintext);
}

/** HPKE `info` of the CEK wrap, and its AAD: the row it belongs to and the key it is addressed to (as base64url text). */
export const cekInfo = (): Bytes => utf8(LABEL.hpkeCek);
export const cekAad = (rowId: string, keyId: string): Bytes => utf8(`${checkRowId(rowId)}\0${keyId}`);

export interface WrappedCek {
  keyIdRaw: Bytes;
  enc: Bytes;
  ct: Bytes;
}

/** `wrapped_cek` = 0x01 || suite(0x01) || key_id(16 raw) || enc(65) || ciphertext(48): 131 bytes. */
export const packWrappedCek = (wrapped: WrappedCek): Bytes =>
  concat(Uint8Array.of(FORMAT_VERSION, HPKE_SUITE_BASE), wrapped.keyIdRaw, wrapped.enc, wrapped.ct);

/** Strict reader: an unknown version or suite byte (the auth-mode suite included), or any other length, is a hard failure. */
export function parseWrappedCek(bytes: Uint8Array): WrappedCek {
  if (bytes.length !== WRAPPED_CEK_BYTES || bytes[0] !== FORMAT_VERSION || bytes[1] !== HPKE_SUITE_BASE) {
    throw new CryptoFormatError('Unknown or damaged wrapped key');
  }
  const keyEnd = 2 + KEY_ID_BYTES;
  const encEnd = keyEnd + P256_POINT_BYTES;
  return { keyIdRaw: bytes.slice(2, keyEnd), enc: bytes.slice(keyEnd, encEnd), ct: bytes.slice(encEnd) };
}

/** Wraps a CEK for the owner of `recipient`: the value of `messages.wrapped_cek` (with `key_id` = recipient.keyId, `wrap_kind` 'user'). */
export async function sealCek(cek: Bytes, rowId: string, recipient: PublicKey): Promise<Bytes> {
  if (cek.length !== CEK_BYTES) {
    throw new CryptoFormatError('A content key is 32 bytes');
  }
  const { enc, ct } = await hpkeSeal(recipient.key, cekInfo(), cekAad(rowId, recipient.keyId), cek);
  if (enc.length !== P256_POINT_BYTES || ct.length !== CEK_BYTES + GCM_TAG_BYTES) {
    throw new CryptoFormatError('The sealed key has an unexpected size');
  }
  return packWrappedCek({ keyIdRaw: recipient.keyIdRaw, enc, ct });
}
