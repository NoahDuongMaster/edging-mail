import { toBase64Url } from '../../../shared/crypto/client';
import type { Attachment, Message } from '../../types';
import { openAttachmentBytes } from './files';
import { sameOriginFetch } from './types';
import type { Fetcher, OpenKey } from './types';

// Pictures a mail carries inside itself: `<img src="cid:logo">` points at the attachment whose content id is `logo`. They are opened here and put
// in the page as `data:` images (the page policy allows `data:` and not `blob:`), only after the reader chose to show images, only for real
// picture types and only up to a size and count that keep a hostile mail from filling the browser's memory.

export const MAX_INLINE_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_INLINE_TOTAL_BYTES = 15 * 1024 * 1024;
export const MAX_INLINE_IMAGES = 20;

// No SVG: a picture format that can carry markup is not worth the risk for a logo.
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif', 'image/bmp']);

/** `cid:Logo%40x`, `<logo@x>` and `logo@x` name the same part. Compared case-insensitively, without brackets. */
export function normalizeCid(value: string): string {
  let text = value.trim();
  if (/^cid:/i.test(text)) {
    text = text.slice(4);
  }
  try {
    text = decodeURIComponent(text);
  } catch {
    // not percent-encoded text: compared as it is
  }
  return text
    .trim()
    .replace(/^<(.*)>$/, '$1')
    .toLowerCase();
}

export interface EmbeddedImages {
  /** Normalized content id -> `data:` URL. */
  urls: Map<string, string>;
  /** Pictures the mail points at that could not be shown (too big, damaged, not a picture type). A reference to nothing is not counted. */
  failed: number;
}

/** Standard (padded) base64 of the bytes: what a `data:` URL needs. */
const base64Of = (bytes: Uint8Array): string => {
  const text = toBase64Url(bytes).replaceAll('-', '+').replaceAll('_', '/');
  return text + '='.repeat((4 - (text.length % 4)) % 4);
};

export async function loadEmbeddedImages(
  message: Message,
  attachments: readonly Attachment[],
  cids: readonly string[],
  key: OpenKey | null,
  fetcher: Fetcher = sameOriginFetch
): Promise<EmbeddedImages> {
  const result: EmbeddedImages = { urls: new Map(), failed: 0 };
  let total = 0;
  for (const cid of new Set(cids.map((value) => normalizeCid(value)).slice(0, MAX_INLINE_IMAGES))) {
    const attachment = attachments.find(
      (item) => item.content_id !== null && item.content_id !== undefined && normalizeCid(item.content_id) === cid
    );
    if (attachment === undefined) {
      continue;
    }
    const type = attachment.mime_type.trim().toLowerCase();
    if (!IMAGE_TYPES.has(type) || attachment.size > MAX_INLINE_IMAGE_BYTES || total + attachment.size > MAX_INLINE_TOTAL_BYTES) {
      result.failed += 1;
      continue;
    }
    try {
      // One at a time: the budget above is only a budget if the next picture waits for the last one.
      const bytes = await openAttachmentBytes(message, attachment, key, fetcher);
      if (bytes.length > MAX_INLINE_IMAGE_BYTES) {
        result.failed += 1;
        continue;
      }
      total += bytes.length;
      result.urls.set(cid, `data:${type};base64,${base64Of(bytes)}`);
    } catch {
      result.failed += 1;
    }
  }
  return result;
}
