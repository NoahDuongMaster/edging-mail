import { describe, expect, it } from 'vitest';
import {
  isTypingTarget,
  isUndoShortcut,
  SELECTION_SHORTCUTS,
  SHORTCUT_GROUPS,
  shortcutHint,
  shortcutOf,
  SINGLE_KEY_SHORTCUTS,
  TRIAGE_SHORTCUTS,
  type ShortcutKey
} from '../../src/client/lib/shortcuts';
import { tr } from '../../src/client/lib/i18n';

// The mailbox's keys (lib/shortcuts.ts): single keys are shortcuts only outside fields and only while the person has them on (WCAG 2.1.4);
// Ctrl/Cmd+Z is the toast's Undo and stays on, never inside a field.

const press = (key: string, extra: Partial<ShortcutKey> & { shiftKey?: boolean } = {}) => ({
  key,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  isComposing: false,
  ...extra
});
const page = { tagName: 'BODY', isContentEditable: false };
const field = { tagName: 'INPUT', isContentEditable: false };
const editor = { tagName: 'DIV', isContentEditable: true };

describe('the selection and the menu keys (J6-26, J6-31)', () => {
  it('maps x, b and l, and Shift+J / Shift+K to growing the selection (never a plain J or K)', () => {
    expect(shortcutOf(press('x'), page)).toBe('select');
    expect(shortcutOf(press('b'), page)).toBe('snooze');
    expect(shortcutOf(press('l'), page)).toBe('label');
    expect(shortcutOf(press('J', { shiftKey: true }), page)).toBe('selectNext');
    expect(shortcutOf(press('K', { shiftKey: true }), page)).toBe('selectPrevious');
    expect(shortcutOf(press('J'), page)).toBeNull();
    expect(shortcutOf(press('x'), field)).toBeNull();
    expect(shortcutOf(press('x'), page, false)).toBeNull();
  });

  it('gives each action its keycap for a hint (row menu, reader tooltips), none for an action without a key', () => {
    expect(shortcutHint('archive')).toBe('E');
    expect(shortcutHint('snooze')).toBe('B');
    expect(shortcutHint('label')).toBe('L');
    expect(shortcutHint('next')).toBe('J');
    expect(shortcutHint('move')).toBe('V');
    expect(shortcutHint('read')).toBe('Shift+I');
    expect(shortcutHint('selectNext')).toBeUndefined();
  });

  it('maps Shift+I to Mark as read and v to Move to folder (J6-40); a capital I without Shift is no key', () => {
    expect(shortcutOf(press('I', { shiftKey: true }), page)).toBe('read');
    expect(shortcutOf(press('I'), page)).toBeNull();
    expect(shortcutOf(press('i'), page)).toBeNull();
    expect(shortcutOf(press('v'), page)).toBe('move');
    expect(shortcutOf(press('I', { shiftKey: true }), field)).toBeNull();
    expect(shortcutOf(press('v'), page, false)).toBeNull();
  });

  it('acts on the whole selection with the triage keys only: e # s u Shift+I b l v, never r a f or x (J6-38)', () => {
    expect([...SELECTION_SHORTCUTS].toSorted()).toEqual(['archive', 'label', 'move', 'read', 'snooze', 'star', 'trash', 'unread']);
    const note = SHORTCUT_GROUPS.find((group) => group.id === 'act')?.note;
    expect(note?.textKey).toBe('shortcuts.selection_note');
    expect(note?.keys.map((chord) => chord.join('+'))).toEqual(['E', '#', 'S', 'U', '{shift}+I', 'B', 'L', 'V']);
  });
});

describe('the one list of keys (the ? dialog and Settings > Keyboard, J4-29 / J6-28)', () => {
  const entries = SHORTCUT_GROUPS.flatMap((group) => group.entries);

  it('groups the keys as Move around, Act on a message, Select several messages, Compose, each named in the catalogue', () => {
    expect(SHORTCUT_GROUPS.map((group) => group.id)).toEqual(['move', 'act', 'select', 'compose']);
    for (const group of SHORTCUT_GROUPS) {
      expect(tr(group.titleKey), group.id).not.toBe(group.titleKey);
    }
    for (const entry of entries) {
      expect(tr(entry.nameKey), entry.id).not.toBe(entry.nameKey);
      expect(entry.keys.length, entry.id).toBeGreaterThan(0);
    }
  });

  it('lists every key the mailbox answers to once: each single key, the arrows, Shift+F10, Ctrl+Z, Ctrl+Enter', () => {
    const ids = entries.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const { shortcut } of [...SINGLE_KEY_SHORTCUTS, ...TRIAGE_SHORTCUTS]) {
      expect(ids, shortcut).toContain(shortcut);
    }
    for (const id of ['rows', 'menu', 'undo', 'send', 'selectNext', 'selectPrevious', 'clear']) {
      expect(ids, id).toContain(id);
    }
    // A single key is the key its handler answers to.
    for (const entry of entries.filter((item) => item.single)) {
      const cap = entry.keys[0]?.[0] ?? '';
      expect(shortcutOf(press(['?', '#', '/'].includes(cap) ? cap : cap.toLowerCase()), page), entry.id).toBe(entry.id);
    }
  });
});

describe('shortcutOf', () => {
  it('maps / c C j k and nothing else, outside fields, with no modifier', () => {
    expect(shortcutOf(press('/'), page)).toBe('search');
    expect(shortcutOf(press('c'), page)).toBe('compose');
    expect(shortcutOf(press('C'), page)).toBe('compose');
    expect(shortcutOf(press('j'), page)).toBe('next');
    expect(shortcutOf(press('k'), page)).toBe('previous');
    expect(shortcutOf(press('w'), page)).toBeNull();
    expect(shortcutOf(press('c', { ctrlKey: true }), page)).toBeNull();
    expect(shortcutOf(press('c', { metaKey: true }), page)).toBeNull();
    expect(shortcutOf(press('j', { altKey: true }), page)).toBeNull();
    expect(shortcutOf(press('j', { isComposing: true }), page)).toBeNull();
    expect(shortcutOf(press('c'), null)).toBe('compose');
  });

  it('never takes a key typed in a field, a list box or the compose editor', () => {
    for (const target of [
      field,
      { tagName: 'TEXTAREA', isContentEditable: false },
      { tagName: 'SELECT', isContentEditable: false },
      editor
    ]) {
      expect(shortcutOf(press('c'), target)).toBeNull();
      expect(isTypingTarget(target)).toBe(true);
    }
    expect(isTypingTarget(page)).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });

  it('is off for every key when single-key shortcuts are turned off in Settings', () => {
    for (const key of ['/', 'c', 'C', 'j', 'k']) {
      expect(shortcutOf(press(key), page, false), key).toBeNull();
      expect(shortcutOf(press(key), page, true), key).not.toBeNull();
    }
  });

  it('lists every single-key shortcut once for Settings, with the key on its keycap', () => {
    expect(SINGLE_KEY_SHORTCUTS.map((entry) => entry.shortcut)).toEqual(['search', 'compose', 'next', 'previous']);
    for (const { shortcut, key } of SINGLE_KEY_SHORTCUTS) {
      expect(shortcutOf(press(key.toLowerCase()), page), key).toBe(shortcut);
    }
  });
});

describe('isUndoShortcut', () => {
  it('is Ctrl+Z or Cmd+Z, without Shift (redo) or Alt, outside fields', () => {
    expect(isUndoShortcut(press('z', { ctrlKey: true }), page)).toBe(true);
    expect(isUndoShortcut(press('z', { metaKey: true }), page)).toBe(true);
    expect(isUndoShortcut(press('Z', { ctrlKey: true }), null)).toBe(true);
    expect(isUndoShortcut(press('z'), page)).toBe(false);
    expect(isUndoShortcut(press('z', { ctrlKey: true, shiftKey: true }), page)).toBe(false);
    expect(isUndoShortcut(press('z', { ctrlKey: true, altKey: true }), page)).toBe(false);
    expect(isUndoShortcut(press('y', { ctrlKey: true }), page)).toBe(false);
  });

  it('leaves Ctrl+Z to a field (its own undo of what was typed)', () => {
    expect(isUndoShortcut(press('z', { ctrlKey: true }), field)).toBe(false);
    expect(isUndoShortcut(press('z', { metaKey: true }), editor)).toBe(false);
  });
});
