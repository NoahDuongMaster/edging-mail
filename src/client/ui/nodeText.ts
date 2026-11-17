import type React from 'react';

/**
 * The words of a React node as plain text (the name of an InfoTip, "About {label}", when the label is an element round its words:
 * `<span id=...>Shared device</span>`; the words a tip says to screen readers when it opens).
 */
export function nodeText(node: React.ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map((part: React.ReactNode) => nodeText(part)).join('');
  }
  if (node !== null && typeof node === 'object' && 'props' in node) {
    return nodeText((node.props as { children?: React.ReactNode }).children);
  }
  return '';
}
