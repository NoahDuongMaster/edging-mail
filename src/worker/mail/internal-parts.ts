import { decodeCanonical, FORMAT_VERSION, GCM_TAG_BYTES, isUuid, IV_BYTES } from '../../shared/crypto/server';
import type { Bytes } from '../../shared/crypto/server';
import { routingAddress } from '../addresses';
import type { ErrorCode } from '../errors';
import { isEmail } from '../utils';
import { parseWrappedCekFor } from './blobs';
import * as limit from './internal-limits';

// The parts of `POST /api/messages/internal` that carry content, checked for SHAPE only: the server cannot read a sealed part, so it makes sure
// it is what the format allows (canonical base64url, version byte, a size window, the key id in the wrapped key) and within the caps. Nothing
// here touches D1 or R2. A refusal carries the registry code and, when it helps, a more specific English text (never an echo of what was sent).

/** What a sealed blob adds to the plaintext: version byte, IV and tag. */
export const BLOB_OVERHEAD = 1 + IV_BYTES + GCM_TAG_BYTES;

export interface SealedAttachment {
  id: string;
  bytes: Bytes;
  metaBlob: string;
  /** The size of the file itself (what the sealed blob holds), which is what the attachment row shows. */
  size: number;
}

export interface SealedPart {
  id: string;
  keyId: string;
  wrappedCek: string;
  summaryBlob: string;
  bodyBlob: string;
  attachments: SealedAttachment[];
  /** Sealed bytes of the parts and the attachments: the `size` of the row. */
  bytes: number;
}

export interface PlainAttachment {
  filename: string;
  mimeType: string;
  bytes: Bytes;
}

export interface PlainPart {
  subject: string;
  text: string | null;
  html: string | null;
  attachments: PlainAttachment[];
}

export class Refusal extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly detail: string | undefined
  ) {
    super(code);
  }
}

export function refuse(code: ErrorCode, detail?: string): never {
  throw new Refusal(code, detail);
}

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const hasLineBreak = (value: string): boolean => /[\r\n]/.test(value);

/**
 * A header-like text: a string of one line within `max` characters. Length and count caps answer `400 invalid_request` with the reason named
 * (only SIZE caps are `413`).
 */
function oneLine(value: unknown, name: string, max: number, required: boolean): string {
  if (typeof value !== 'string') {
    refuse('invalid_request', `${name} must be text`);
  }
  if (required && value === '') {
    refuse('invalid_request', `${name} must not be empty`);
  }
  if (value.length > max) {
    refuse('invalid_request', `${name} is too long (at most ${max} characters)`);
  }
  if (hasLineBreak(value)) {
    refuse('invalid_request', `${name} must be one line`);
  }
  return value;
}
const byteLength = (value: string): number => new TextEncoder().encode(value).byteLength;

/** An object with only these keys; anything else is the caller's mistake. */
export function only(value: Record<string, unknown>, keys: readonly string[]): void {
  if (!Object.keys(value).every((key) => keys.includes(key))) {
    refuse('invalid_body');
  }
}

/** Over all copies of one request: attachment objects and bytes, and every id (rows and attachments), which must all be different. */
export class Totals {
  objects = 0;
  bytes = 0;
  private readonly ids = new Set<string>();

  takeId(id: unknown, what: string): string {
    if (!isUuid(id)) {
      refuse('invalid_request', `${what} must be a lower-case UUID`);
    }
    if (this.ids.has(id)) {
      refuse('invalid_request', 'Every id must be different');
    }
    this.ids.add(id);
    return id;
  }

  countAttachment(bytes: number): void {
    this.objects += 1;
    this.bytes += bytes;
    if (this.objects > limit.MAX_ATTACHMENT_OBJECTS || this.bytes > limit.MAX_ATTACHMENT_BYTES) {
      refuse('payload_too_large', 'The attachments of all the copies together are too large');
    }
  }
}

/** A sealed blob (`0x01 || iv || ciphertext || tag`) as the canonical text it arrived as and its bytes. */
function blob(value: unknown, max: number, what: string): { text: string; bytes: Bytes } {
  const bytes = decodeCanonical(value);
  if (typeof value !== 'string' || bytes === null) {
    refuse('invalid_request', `${what} must be an encrypted blob`);
  }
  if (bytes[0] !== FORMAT_VERSION || bytes.length < BLOB_OVERHEAD) {
    refuse('invalid_request', `${what} must be an encrypted blob`);
  }
  if (bytes.length > max) {
    refuse('payload_too_large', `${what} is too large`);
  }
  return { text: value, bytes };
}

export function addressList(value: unknown, name: string, required: boolean): string[] {
  if (value === undefined && !required) {
    return [];
  }
  if (!Array.isArray(value)) {
    refuse('invalid_request', `${name} must be a list of addresses`);
  }
  if (value.length > limit.MAX_INTERNAL_RECIPIENTS) {
    refuse('too_many_recipients');
  }
  const seen = new Set<string>();
  const list: string[] = [];
  for (const item of value as unknown[]) {
    const address = typeof item === 'string' ? item.trim() : undefined;
    if (address === '') {
      continue;
    }
    if (address === undefined) {
      refuse('invalid_request', `${name} holds something that is not an address`);
    }
    if (address.length > limit.MAX_ADDRESS_CHARS || !isEmail(address) || routingAddress(address) === null) {
      refuse('invalid_request', `${name} holds something that is not an address`);
    }
    if (!seen.has(address.toLowerCase())) {
      seen.add(address.toLowerCase());
      list.push(address);
    }
  }
  return list;
}

function sealedAttachments(value: unknown, totals: Totals): SealedAttachment[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value) || value.length > limit.MAX_ATTACHMENTS_PER_COPY) {
    refuse('invalid_request', `A copy has at most ${limit.MAX_ATTACHMENTS_PER_COPY} attachments`);
  }
  return (value as unknown[]).map((item) => {
    if (!isRecord(item)) {
      refuse('invalid_request', 'An attachment must be an object');
    }
    only(item, ['id', 'blob', 'meta_blob']);
    const id = totals.takeId(item.id, 'An attachment id');
    const file = blob(item.blob, limit.MAX_ATTACHMENT_BYTES, 'An attachment');
    const meta = blob(item.meta_blob, limit.MAX_META_BLOB_BYTES, 'An attachment description');
    totals.countAttachment(file.bytes.length);
    return { id, bytes: file.bytes, metaBlob: meta.text, size: file.bytes.length - BLOB_OVERHEAD };
  });
}

export const SEALED_KEYS = ['id', 'key_id', 'wrapped_cek', 'summary_blob', 'body_blob', 'attachments'] as const;

/** A copy the browser sealed. The caller has already checked the keys of `value` (SEALED_KEYS plus its own). */
export function sealedPart(value: Record<string, unknown>, what: string, totals: Totals): SealedPart {
  const id = totals.takeId(value.id, `${what}.id`);
  const keyId = value.key_id;
  if (typeof keyId !== 'string' || !/^[\w-]{22}$/.test(keyId)) {
    refuse('invalid_request', `${what}.key_id is not a key id`);
  }
  const wrappedCek = parseWrappedCekFor(value.wrapped_cek, keyId);
  if (wrappedCek === null) {
    refuse('invalid_request', `${what}.wrapped_cek must be a wrapped key that names ${what}.key_id`);
  }
  const summary = blob(value.summary_blob, limit.MAX_SUMMARY_BLOB_BYTES, `${what}.summary_blob`);
  const body = blob(value.body_blob, limit.MAX_BODY_BLOB_BYTES, `${what}.body_blob`);
  const attachments = sealedAttachments(value.attachments, totals);
  const bytes = summary.bytes.length + body.bytes.length + attachments.reduce((total, attachment) => total + attachment.bytes.length, 0);
  return { id, keyId, wrappedCek, summaryBlob: summary.text, bodyBlob: body.text, attachments, bytes };
}

function text(value: unknown, name: string): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== 'string') {
    refuse('invalid_request', `${name} must be text`);
  }
  return value === '' ? null : value;
}

function plainAttachments(value: unknown, totals: Totals): PlainAttachment[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value) || value.length > limit.MAX_ATTACHMENTS_PER_COPY) {
    refuse('invalid_request', `A copy has at most ${limit.MAX_ATTACHMENTS_PER_COPY} attachments`);
  }
  return (value as unknown[]).map((item) => {
    if (!isRecord(item)) {
      refuse('invalid_request', 'An attachment must be an object');
    }
    only(item, ['filename', 'mime_type', 'content_base64']);
    const { filename: rawName, mime_type: rawType, content_base64: content } = item;
    const filename = oneLine(rawName, 'An attachment file name', limit.MAX_FIELD_CHARS, true);
    const mimeType = oneLine(rawType, 'An attachment type', limit.MAX_FIELD_CHARS, false);
    if (typeof content !== 'string') {
      refuse('invalid_request', 'An attachment must be base64');
    }
    // Checked before decoding: base64 is a third larger than the bytes it holds.
    if (content.length > Math.ceil(((limit.MAX_ATTACHMENT_BYTES - totals.bytes) * 4) / 3) + 4) {
      refuse('payload_too_large', 'The attachments of all the copies together are too large');
    }
    let bytes: Bytes;
    try {
      bytes = Uint8Array.from(atob(content), (char) => char.codePointAt(0) ?? 0);
    } catch {
      refuse('invalid_request', 'An attachment is not valid base64');
    }
    totals.countAttachment(bytes.length);
    return { filename, mimeType: mimeType === '' ? 'application/octet-stream' : mimeType, bytes };
  });
}

/** A copy for a person without keys, in the clear (over TLS): the server seals it. */
export function plainPart(value: unknown, totals: Totals): PlainPart {
  if (!isRecord(value)) {
    refuse('invalid_request', 'plain must be an object');
  }
  only(value, ['subject', 'text', 'html', 'attachments']);
  const subject = oneLine(value.subject, 'The subject', limit.MAX_SUBJECT_CHARS, false);
  const bodyText = text(value.text, 'text');
  const bodyHtml = text(value.html, 'html');
  if (byteLength(bodyText ?? '') + byteLength(bodyHtml ?? '') > limit.MAX_PLAIN_BODY_BYTES) {
    refuse('payload_too_large', 'The text and html of a copy are too large');
  }
  return {
    subject: subject === '' ? '(No Subject)' : subject,
    text: bodyText,
    html: bodyHtml,
    attachments: plainAttachments(value.attachments, totals)
  };
}
