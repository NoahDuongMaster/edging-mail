import type { Bytes } from '../../../shared/crypto/client';

// The shapes of sealed send (reports/e2e-contract.md sections 2 and 3). Field names of the wire objects (`key_id`, `wrapped_cek`, ...) are the
// server's; the objects the UI hands in and gets back use camelCase.

/** What the person wrote. `null` is an absent part (a plain-text mail has no html). */
export interface MailContent {
  subject: string;
  text: string | null;
  html: string | null;
}

/** One file to send: its bytes are read from the browser (never base64 until a plain copy needs it). */
export interface OutgoingAttachment {
  filename: string;
  mimeType: string;
  contentId: string | null;
  bytes: Bytes;
}

export interface SealedAttachment {
  id: string;
  blob: string;
  meta_blob: string;
}

/** One sealed copy: for the sender's Sent folder, or (with `address`) for one recipient person. */
export interface Sealed {
  id: string;
  key_id: string;
  wrapped_cek: string;
  summary_blob: string;
  body_blob: string;
  attachments?: SealedAttachment[];
}

export type SealedCopy = Sealed & { address: string };

export interface PlainAttachment {
  filename: string;
  mime_type: string;
  content_base64: string;
}

/** A copy for a person without keys: the server seals it (it sees this content over TLS). */
export interface PlainCopy {
  address: string;
  plain: { subject: string; text: string | null; html: string | null; attachments?: PlainAttachment[] };
}

export type Copy = SealedCopy | PlainCopy;

/** What the server knows about one address. `publicKey` is the SPKI as base64url; `keyId` is its id (both or neither). */
export interface KeyAnswer {
  internal: boolean;
  publicKey?: string;
  keyId?: string;
}

/** Keyed by the address as typed, lower-cased and trimmed. */
export type LookupMap = Map<string, KeyAnswer>;
