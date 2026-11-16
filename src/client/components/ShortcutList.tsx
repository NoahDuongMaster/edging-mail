import React from 'react';
import { useT, type MessageKey, type TFunction } from '../lib/i18n';
import { SHORTCUT_GROUPS, type KeyCap, type KeyChord } from '../lib/shortcuts';
import { Kbd } from '../ui';
import './shortcuts.css';

/** The keys named in the language of the page (the words on them); every other key is drawn as it is printed. */
const NAMED_CAPS = new Map<KeyCap, MessageKey>([
  ['{shift}', 'shortcuts.key_shift'],
  ['{ctrl}', 'compose.key_ctrl'],
  ['{enter}', 'compose.key_enter'],
  ['{esc}', 'shortcuts.key_esc']
]);

/** The name of a keycap. */
function capName(cap: KeyCap, tr: TFunction): string {
  const key = NAMED_CAPS.get(cap);
  return key === undefined ? cap : tr(key);
}

/** One chord: its keys pressed together, "+" between them (a screen reader says "Shift + F10"). */
function Chord({ chord }: { chord: KeyChord }): React.ReactElement {
  const tr = useT();
  return (
    <span className="sk-chord">
      {chord.map((cap, at) => (
        <React.Fragment key={cap}>
          {at > 0 ? <span className="sk-plus">+</span> : null}
          <Kbd>{capName(cap, tr)}</Kbd>
        </React.Fragment>
      ))}
    </span>
  );
}

/**
 * The ways to press one shortcut, with ONE rule for every list (J3-28): "+" between the keys of a chord (pressed together), "or" between
 * alternatives. The joiners are text, so a screen reader says "Shift + F10" and "↑ or ↓".
 */
export function KeyCombo({ keys }: { keys: readonly KeyChord[] }): React.ReactElement {
  const tr = useT();
  return (
    <span className="sk-combo">
      {keys.map((chord, index) => (
        <React.Fragment key={chord.join('+')}>
          {index > 0 ? <span className="sk-or">{tr('shortcuts.or')}</span> : null}
          <Chord chord={chord} />
        </React.Fragment>
      ))}
    </span>
  );
}

/**
 * Several keys in a row, each its own chord (the keys that act on a whole selection: E # S U Shift+I B L V), wrapping as words do. Used under
 * Act on a message here and in the reading pane's selection summary.
 */
export function KeyRun({ chords }: { chords: readonly KeyChord[] }): React.ReactElement {
  return (
    <span className="sk-note-keys">
      {chords.map((chord) => (
        <Chord key={chord.join('+')} chord={chord} />
      ))}
    </span>
  );
}

interface ShortcutListProps {
  /** The level of the group headings ("Move around", "Act on a message", "Compose"): one under the heading of the place it is shown in. */
  headingLevel: 3 | 4 | 5;
  /** Prefix of the heading ids (the ? dialog and Settings can be on screen together). */
  idPrefix: string;
  /** Two columns where the width allows (the ? dialog): Act on a message beside the other three groups. */
  columns?: boolean;
}

/**
 * Every keyboard shortcut of the mailbox, in four groups, from ONE source (lib/shortcuts SHORTCUT_GROUPS): the ? dialog and Settings >
 * Keyboard both draw this list (J4-29, J6-28), so the two never disagree. Each group is a description list (keys, what they do).
 */
export function ShortcutList({ headingLevel, idPrefix, columns = false }: ShortcutListProps): React.ReactElement {
  const tr = useT();
  const Heading = `h${headingLevel}` as const;
  return (
    <div className="sk-groups" data-columns={columns ? 'true' : undefined}>
      {SHORTCUT_GROUPS.map((group) => (
        <section key={group.id} className="sk-group" data-group={group.id} aria-labelledby={`${idPrefix}-${group.id}`}>
          <Heading id={`${idPrefix}-${group.id}`} className="sk-title">
            {tr(group.titleKey)}
          </Heading>
          <dl className="sk-list">
            {group.entries.map((entry) => (
              <div key={entry.id} className="sk-row">
                <dt>
                  <KeyCombo keys={entry.keys} />
                </dt>
                <dd>{tr(entry.nameKey)}</dd>
              </div>
            ))}
          </dl>
          {/* J6-38: which of these keys act on every ticked message (Reply, Reply all and Forward stay on the open one). */}
          {group.note === undefined ? null : (
            <p className="sk-note">
              {tr(group.note.textKey)} <KeyRun chords={group.note.keys} />
            </p>
          )}
        </section>
      ))}
    </div>
  );
}
