import type React from 'react';

/** Hands an element to a ref the caller gave us, whether it is a ref object or a callback ref. */
export function assignRef<T>(ref: React.Ref<T> | undefined, node: T | null): void {
  if (typeof ref === 'function') {
    ref(node);
  } else if (ref !== undefined && ref !== null) {
    // Setting `current` is what a ref is for.
    const holder: { current: T | null } = ref;
    holder.current = node;
  }
}
