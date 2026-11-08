import type { Bytes } from '../../../shared/crypto/client';

/** Hands bytes to the person as a file download. The bytes are opened in memory; the browser writes the file where the person chose. */
export function saveBytes(bytes: Bytes, fileName: string): void {
  // An opaque type: whatever the file is, it is saved and never rendered by this page.
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.rel = 'noopener';
  link.style.display = 'none';
  // Not document.body.append(): @cloudflare/workers-types overrides Element.append with the HTMLRewriter signature.
  // eslint-disable-next-line unicorn/prefer-dom-node-append -- see above
  document.body.appendChild(link);
  link.click();
  link.remove();
  // The download has started by the time the timer fires; the copy in memory goes.
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
