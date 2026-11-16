// Keyboard shortcuts of the mailbox. Pure (no DOM reads) so they can be tested in Node. ONE source for the keys (J4-29, J6-28): the key
// handler of the mailbox, the ? dialog, Settings > Keyboard, the key hints of the row menu and the reader's tooltips all read this file.
import type { MessageKey } from '../../shared/i18n';

/** Settings > Keyboard asks the mailbox to open the ? dialog with this window event (Settings has no handle on the mailbox's state). */
export const SHOW_SHORTCUTS_EVENT = 'edging-mail:show-shortcuts';

/** The keys that move around: search, compose, the next and the previous message. */
export type Shortcut = 'search' | 'compose' | 'next' | 'previous';

/**
 * The keys that act on a message (Gmail's keys): on the row that has focus in the list, else on the open message; while messages are
 * ticked, the triage keys (SELECTION_SHORTCUTS) act on all of them instead. `read` is Shift+I, `move` is v (Move to folder). `select` (x)
 * ticks the row, `selectNext` / `selectPrevious` (Shift+J / Shift+K) grow the selection; `help` shows every key.
 */
export type TriageShortcut =
  | 'archive'
  | 'trash'
  | 'star'
  | 'unread'
  | 'read'
  | 'snooze'
  | 'label'
  | 'move'
  | 'reply'
  | 'replyAll'
  | 'forward'
  | 'select'
  | 'selectNext'
  | 'selectPrevious'
  | 'help';

/** Every single-key shortcut of the mailbox. */
export type MailShortcut = Shortcut | TriageShortcut;

export interface ShortcutKey {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  isComposing: boolean;
  /** Shift turns j and k into the keys that grow the selection. Absent: not held. */
  shiftKey?: boolean;
}

/** A key press as the Undo shortcut needs it (Shift turns Ctrl+Z into Redo in most apps). */
export interface UndoKey extends ShortcutKey {
  shiftKey: boolean;
}

export interface ShortcutTarget {
  tagName: string;
  isContentEditable: boolean;
}

const TYPING_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

/** True when the key goes to a field the person types in (a text box, a list box, the compose editor): no shortcut may take it. */
export function isTypingTarget(target: ShortcutTarget | null): boolean {
  return target !== null && (TYPING_TAGS.has(target.tagName) || target.isContentEditable);
}

/**
 * The single-key shortcuts that move around, with the key printed on the keycap. The key is the same in every language; the name of each
 * action comes from the catalogue where it is shown.
 */
export const SINGLE_KEY_SHORTCUTS: readonly { readonly shortcut: Shortcut; readonly key: string }[] = [
  { shortcut: 'search', key: '/' },
  { shortcut: 'compose', key: 'C' },
  { shortcut: 'next', key: 'J' },
  { shortcut: 'previous', key: 'K' }
];

/**
 * The single-key shortcuts that act on a message, with the key on the keycap and the catalogue key of the action's name (the words of its
 * button). `?` opens the list of every key (App, ShortcutsDialog).
 */
export const TRIAGE_SHORTCUTS: readonly { readonly shortcut: TriageShortcut; readonly key: string; readonly nameKey: MessageKey }[] = [
  { shortcut: 'archive', key: 'E', nameKey: 'action.archive' },
  { shortcut: 'trash', key: '#', nameKey: 'action.move_to_trash' },
  { shortcut: 'star', key: 'S', nameKey: 'shortcuts.star' },
  { shortcut: 'unread', key: 'U', nameKey: 'action.mark_unread' },
  // A chord (Gmail's): the hint reads "Shift+I"; shortcutOf answers it, the single-key map below leaves it out.
  { shortcut: 'read', key: 'Shift+I', nameKey: 'action.mark_read' },
  { shortcut: 'snooze', key: 'B', nameKey: 'action.snooze' },
  { shortcut: 'label', key: 'L', nameKey: 'reader.add_label' },
  { shortcut: 'move', key: 'V', nameKey: 'action.move_to_folder' },
  { shortcut: 'reply', key: 'R', nameKey: 'action.reply' },
  { shortcut: 'replyAll', key: 'A', nameKey: 'action.reply_all' },
  { shortcut: 'forward', key: 'F', nameKey: 'action.forward' },
  { shortcut: 'select', key: 'X', nameKey: 'shortcuts.select' },
  { shortcut: 'help', key: '?', nameKey: 'shortcuts.help' }
];

/** The key each triage shortcut answers to: a lower-case letter (Shift+letter is another key), or `#` and `?`, which take Shift anyway. */
const TRIAGE_KEYS: ReadonlyMap<string, TriageShortcut> = new Map(
  TRIAGE_SHORTCUTS.filter(({ key }) => key.length === 1).map(({ shortcut, key }): [string, TriageShortcut] => [key.toLowerCase(), shortcut])
);

/**
 * The keys that act on every ticked message while a selection exists (J6-38, J4-41): one batch and one toast, as the selection bar's own
 * buttons; b, l and v open the bar's Snooze, Add label and Move to folder lists. Reply, Reply all and Forward stay on the open message.
 */
export const SELECTION_SHORTCUTS: readonly TriageShortcut[] = ['archive', 'trash', 'star', 'unread', 'read', 'snooze', 'label', 'move'];

/** The lists of the selection bar that b, l and v open. */
export type SelectionMenuView = 'snooze' | 'label' | 'move';

/**
 * The keycap of a single-key shortcut ("E" for Archive), for a hint beside an action: the row menu's items and the reader toolbar's tooltips
 * (R2). Undefined for an action without a key. Show it only while single-key shortcuts are on (the `shortcuts` device preference).
 */
export function shortcutHint(shortcut: MailShortcut): string | undefined {
  return (
    SINGLE_KEY_SHORTCUTS.find((entry) => entry.shortcut === shortcut)?.key ??
    TRIAGE_SHORTCUTS.find((entry) => entry.shortcut === shortcut)?.key
  );
}

/**
 * Which shortcut a key press is, or null: modified keys (Ctrl+C, Cmd+R, Alt+...) and typing in a field are never shortcuts, and none of
 * them is one when the person turned single-key shortcuts off (`singleKeys` false: Settings, WCAG 2.1.4).
 */
export function shortcutOf(event: ShortcutKey, target: ShortcutTarget | null, singleKeys = true): MailShortcut | null {
  if (!singleKeys) {
    return null;
  }
  if (event.ctrlKey || event.metaKey || event.altKey || event.isComposing) {
    return null;
  }
  if (isTypingTarget(target)) {
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
    case 'J': {
      return event.shiftKey === true ? 'selectNext' : null;
    }
    case 'K': {
      return event.shiftKey === true ? 'selectPrevious' : null;
    }
    case 'I': {
      // Shift+I marks as read (Gmail); a capital I from Caps Lock alone is not a key of the mailbox.
      return event.shiftKey === true ? 'read' : null;
    }
    default: {
      return TRIAGE_KEYS.get(event.key) ?? null;
    }
  }
}

/**
 * True for Ctrl+Z or Cmd+Z (no Shift, no Alt) outside a field: the Undo of the toast on screen. A field keeps its own Undo of what was
 * typed. It has a modifier, so it stays on when single-key shortcuts are off.
 */
export function isUndoShortcut(event: UndoKey, target: ShortcutTarget | null): boolean {
  if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || event.isComposing) {
    return false;
  }
  return (event.key === 'z' || event.key === 'Z') && !isTypingTarget(target);
}

// ---- The list of keys, as people read it (the ? dialog and Settings > Keyboard draw it with ONE component, ShortcutList) ----

/** A key on a keycap. `{shift}`, `{ctrl}`, `{enter}` and `{esc}` are named in the language of the page; the others are printed the same in every language. */
export type KeyCap = string;

/** The keys of one chord, pressed together (drawn with "+" between them). */
export type KeyChord = readonly KeyCap[];

export interface ShortcutEntry {
  /** Stable id (React key, tests). */
  id: string;
  /** The ways to press it: alternatives, drawn with "or" between them. */
  keys: readonly KeyChord[];
  /** What it does, in the words of its button. */
  nameKey: MessageKey;
  /** A single key: off when single-key shortcuts are turned off in Settings. A chord with a modifier always works. */
  single: boolean;
}

export interface ShortcutGroup {
  id: 'move' | 'act' | 'select' | 'compose';
  titleKey: MessageKey;
  entries: readonly ShortcutEntry[];
  /** A line under the group's keys: its words, then the keys it is about (the ? dialog says which keys act on a whole selection). */
  note?: { textKey: MessageKey; keys: readonly KeyChord[] };
}

const single = (id: MailShortcut, nameKey: MessageKey): ShortcutEntry => ({
  id,
  keys: [[shortcutHint(id) ?? '']],
  nameKey,
  single: true
});

const triageName = (id: TriageShortcut): MessageKey => TRIAGE_SHORTCUTS.find((entry) => entry.shortcut === id)?.nameKey ?? 'shortcuts.help';

/** Every key of the mailbox in four groups: moving around, acting on a message, selecting several, writing. */
export const SHORTCUT_GROUPS: readonly ShortcutGroup[] = [
  {
    id: 'move',
    titleKey: 'shortcuts.group_move',
    entries: [
      single('search', 'app.search_mail'),
      single('next', 'reader.older_message'),
      single('previous', 'reader.newer_message'),
      { id: 'rows', keys: [['↑'], ['↓']], nameKey: 'shortcuts.move', single: false },
      single('help', 'shortcuts.help')
    ]
  },
  {
    id: 'act',
    titleKey: 'shortcuts.group_act',
    entries: [
      { id: 'menu', keys: [['{shift}', 'F10']], nameKey: 'shortcuts.row_menu', single: false },
      ...(['archive', 'trash', 'star', 'unread'] as const).map((id) => single(id, triageName(id))),
      // Shift+I is a chord: drawn as Shift + I (and off with the single keys, as Shift+J and Shift+K are).
      { id: 'read', keys: [['{shift}', 'I']], nameKey: triageName('read'), single: false },
      ...(['snooze', 'label', 'move', 'reply', 'replyAll', 'forward'] as const).map((id) => single(id, triageName(id))),
      { id: 'undo', keys: [['{ctrl}', 'Z']], nameKey: 'prefs.undo_action', single: false }
    ],
    note: {
      textKey: 'shortcuts.selection_note',
      keys: SELECTION_SHORTCUTS.map((id): KeyChord => (id === 'read' ? ['{shift}', 'I'] : [shortcutHint(id) ?? '']))
    }
  },
  {
    id: 'select',
    titleKey: 'shortcuts.group_select',
    entries: [
      single('select', triageName('select')),
      {
        id: 'selectNext',
        keys: [
          ['{shift}', 'J'],
          ['{shift}', '↓']
        ],
        nameKey: 'shortcuts.select_down',
        single: false
      },
      {
        id: 'selectPrevious',
        keys: [
          ['{shift}', 'K'],
          ['{shift}', '↑']
        ],
        nameKey: 'shortcuts.select_up',
        single: false
      },
      { id: 'clear', keys: [['{esc}']], nameKey: 'shortcuts.clear_selection', single: false }
    ]
  },
  {
    id: 'compose',
    titleKey: 'shortcuts.group_compose',
    entries: [single('compose', 'action.compose'), { id: 'send', keys: [['{ctrl}', '{enter}']], nameKey: 'shortcuts.send', single: false }]
  }
];
