import type React from 'react';
import { Archive, ChevronDown, Clock, FolderInput, Inbox, ListChecks, Mail, MailOpen, MailX, Star, Tag, Trash2, X } from 'lucide-react';
import { useT } from '../lib/i18n';
import { displayName, folderName, subjectOf } from '../lib/mail';
import { usePrefs } from '../lib/prefs';
import { SHORTCUT_GROUPS } from '../lib/shortcuts';
import { snoozePresets } from '../lib/snooze';
import type { Message } from '../types';
import { avatarHue } from '../theme';
import { Avatar, Button, Menu, type MenuItem, type MenuTriggerProps } from '../ui';
import { RollingText } from './MessageList';
import type { SelectionActions } from './SelectionBar';
import { KeyRun } from './ShortcutList';

/** The id of the summary's heading: the reader pane (a region) is named by it while the summary is shown. */
export const SELECTION_SUMMARY_TITLE_ID = 'sel-summary-title';

/** The folders the selection can be moved to (not the one it is in), as the selection bar's Move to folder. */
const MOVE_TARGETS = ['inbox', 'archive', 'spam', 'trash'] as const;
/** How many of the ticked messages are named (sender and subject); the rest are counted. */
const NAMED = 4;

const ICON = { size: 16, strokeWidth: 1.75, 'aria-hidden': true } as const;

/** The button a menu of the summary opens from: its icon, its words and a chevron (it opens a list). */
function menuTrigger(
  label: string,
  icon: React.ReactNode,
  variant: 'secondary' | 'ghost' = 'secondary'
): (props: MenuTriggerProps) => React.ReactElement {
  return function SummaryMenuTrigger(props) {
    return (
      <Button variant={variant} leadingIcon={icon} trailingIcon={<ChevronDown {...ICON} className="mb-selsum-chevron" />} {...props}>
        {label}
      </Button>
    );
  };
}

export interface SelectionSummaryProps {
  /** The ticked messages, in the list's order (at least one: the summary is shown only then). */
  rows: readonly Message[];
  /** The folder of the list ('all' for a search of all mail): Trash and Spam offer Move to Inbox and Delete forever. */
  folder: string;
  /** Something ticked is unread / not starred: Mark as read and Star are offered (else Mark as unread and Unstar). */
  anyUnread: boolean;
  anyUnstarred: boolean;
  labels: readonly string[];
  /** The selection bar's actions: one batch for all of them, one toast with Undo. */
  actions: SelectionActions;
  /** Clears the selection: the open message comes back in the pane. */
  onClear: () => void;
}

/**
 * The reading pane while messages are ticked (J6-38, J4-41; Outlook's multi-select reading pane): instead of the open message (whose toolbar
 * would act on one message the person did not tick), "3 selected" with the first senders and subjects, the same actions as the selection bar
 * as labelled buttons (one batch, one toast with Undo), and Clear selection, which brings the open message back (Escape does too).
 */
export function SelectionSummary({
  rows,
  folder,
  anyUnread,
  anyUnstarred,
  labels,
  actions,
  onClear
}: SelectionSummaryProps): React.ReactElement {
  const tr = useT();
  const keysOn = usePrefs().shortcuts;
  const note = SHORTCUT_GROUPS.find((group) => group.id === 'act')?.note;
  const count = rows.length;
  const bin = folder === 'trash' || folder === 'spam';
  // Snooze is not offered in Trash, Spam, Sent, Snoozed or an All mail search (as the bar, the reader and the row menu).
  const snoozable = !(bin || folder === 'sent' || folder === 'snoozed' || folder === 'all');
  const named = rows.slice(0, NAMED);
  const rest = count - named.length;
  const snoozeItems: MenuItem[] = snoozePresets(new Date()).map((preset) => ({
    id: preset.id,
    label: preset.label,
    hint: preset.hint,
    icon: <Clock {...ICON} />,
    onSelect: () => actions.snooze(preset.at)
  }));
  const moveItems: MenuItem[] = MOVE_TARGETS.filter((target) => target !== folder).map((target) => ({
    id: target,
    label: folderName(target),
    icon: <FolderInput {...ICON} />,
    onSelect: () => actions.move(target)
  }));
  const labelItems: MenuItem[] = labels.map((label) => ({
    id: label,
    label,
    icon: <Tag {...ICON} />,
    onSelect: () => actions.label(label)
  }));
  return (
    <div className="mb-selsum">
      <div className="mb-selsum-card">
        <span aria-hidden="true" className="mb-selsum-icon">
          <ListChecks size={22} strokeWidth={1.75} />
        </span>
        <h2 id={SELECTION_SUMMARY_TITLE_ID} className="mb-selsum-title">
          {/* The number rolls as rows are ticked (DESIGN-v3 H2); the heading is read as one text. */}
          <RollingText text={tr('list.selected_count', { count })} count={count} />
        </h2>
        <p className="mb-selsum-lead">{tr('list.summary_lead')}</p>
        <ul className="mb-selsum-list">
          {named.map((m) => (
            <li key={m.id} className="mb-selsum-item">
              {/* The people who write are stamps, in their own tint (as in the list, lead review 11). */}
              <Avatar name={displayName(m)} hue={avatarHue(m.from_address)} shape="stamp" size="sm" className="mb-selsum-stamp" />
              <span className="mb-selsum-sender">{displayName(m)}</span>
              <span className="mb-selsum-subject">{subjectOf(m, tr('list.no_subject'))}</span>
            </li>
          ))}
          {rest > 0 ? <li className="mb-selsum-rest">{tr('list.summary_more', { count: rest })}</li> : null}
        </ul>
        <div role="group" aria-label={tr('list.selection_actions')} className="mb-selsum-actions">
          {/* Two tiers: what takes the messages away (the first one is the view's one primary), then what changes them. */}
          <div className="mb-selsum-row">
            {bin ? (
              <>
                <Button variant="primary" leadingIcon={<Inbox {...ICON} />} onClick={actions.restore}>
                  {folder === 'spam' ? tr('action.not_spam') : tr('action.move_to_inbox')}
                </Button>
                <Button variant="danger" leadingIcon={<MailX {...ICON} />} onClick={actions.deleteForever}>
                  {tr('action.delete_forever')}
                </Button>
              </>
            ) : (
              <>
                <Button variant="primary" leadingIcon={<Archive {...ICON} />} onClick={actions.archive}>
                  {tr('action.archive')}
                </Button>
                <Button leadingIcon={<Trash2 {...ICON} />} onClick={actions.trash}>
                  {tr('action.move_to_trash')}
                </Button>
              </>
            )}
            {snoozable ? (
              <Menu label={tr('action.snooze')} items={snoozeItems} trigger={menuTrigger(tr('action.snooze'), <Clock {...ICON} />)} />
            ) : null}
          </div>
          <div className="mb-selsum-row">
            {/* One button whose words change (Mark as read / Mark as unread): focus stays on it when the rows turn. */}
            <Button
              key="read"
              variant="ghost"
              leadingIcon={anyUnread ? <MailOpen {...ICON} /> : <Mail {...ICON} />}
              onClick={anyUnread ? actions.read : actions.unread}
            >
              {anyUnread ? tr('action.mark_read') : tr('action.mark_unread')}
            </Button>
            <Button
              key="star"
              variant="ghost"
              leadingIcon={<Star {...ICON} fill={anyUnstarred ? 'none' : 'currentColor'} />}
              onClick={anyUnstarred ? actions.star : actions.unstar}
            >
              {anyUnstarred ? tr('action.star') : tr('action.unstar')}
            </Button>
            <Menu
              label={tr('action.move_to_folder')}
              items={moveItems}
              trigger={menuTrigger(tr('action.move_to_folder'), <FolderInput {...ICON} />, 'ghost')}
            />
            {labels.length > 0 && !bin ? (
              <Menu
                label={tr('reader.add_label')}
                items={labelItems}
                trigger={menuTrigger(tr('reader.add_label'), <Tag {...ICON} />, 'ghost')}
              />
            ) : null}
          </div>
        </div>
        <Button variant="ghost" className="mb-selsum-clear" leadingIcon={<X {...ICON} />} onClick={onClear}>
          {tr('list.clear_selection')}
        </Button>
        {/* The keys that do the same for all of them (only while single-key shortcuts are on: Settings, WCAG 2.1.4). */}
        {keysOn && note !== undefined ? (
          <p className="mb-selsum-keys">
            {tr(note.textKey)} <KeyRun chords={note.keys} />
          </p>
        ) : null}
      </div>
    </div>
  );
}
