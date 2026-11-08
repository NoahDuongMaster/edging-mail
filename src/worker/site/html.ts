/** Escapes text for HTML content and for double-quoted attributes. */
export const esc = (value: string): string =>
  value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');

/** JSON for an inline <script type="application/ld+json">: nothing in it can close the script element or start a comment. */
export const safeJson = (value: unknown): string =>
  JSON.stringify(value)
    .replaceAll('<', String.raw`\u003c`)
    .replaceAll('>', String.raw`\u003e`)
    .replaceAll('&', String.raw`\u0026`);
