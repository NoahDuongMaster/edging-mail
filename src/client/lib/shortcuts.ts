// Keyboard shortcuts of the mailbox. Pure (no DOM reads) so they can be tested in Node.

export type Shortcut = 'search' | 'compose' | 'next' | 'previous';

export interface ShortcutKey {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  isComposing: boolean;
}

export interface ShortcutTarget {
  tagName: string;
  isContentEditable: boolean;
}

const TYPING_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

/** Which shortcut a key press is, or null: modified keys (Ctrl+C, Cmd+R, Alt+...) and typing in a field are never shortcuts. */
export function shortcutOf(event: ShortcutKey, target: ShortcutTarget | null): Shortcut | null {
  if (event.ctrlKey || event.metaKey || event.altKey || event.isComposing) {
    return null;
  }
  if (target !== null && (TYPING_TAGS.has(target.tagName) || target.isContentEditable)) {
    return null;
  }
  if (event.key === '/') {
    return 'search';
  }
  switch (event.key) {
    case 'c':
    case 'C': {
      return 'compose';
    }
    case 'j': {
      return 'next';
    }
    case 'k': {
      return 'previous';
    }
    default: {
      return null;
    }
  }
}
