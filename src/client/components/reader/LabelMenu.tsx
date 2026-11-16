import React from 'react';
import { Check, CircleAlert, Plus, Tag } from 'lucide-react';
import type { Message } from '../../types';
import type { ThemeTokens } from '../../theme';
import { getLabelChip } from '../../theme';
import { LABEL_NAME_MAX, LABEL_NAME_PATTERN, MAX_LABELS_PER_MESSAGE, labelsOf } from '../../lib/mail';
import { announce } from '../../lib/announce';
import { useT, type MessageKey } from '../../lib/i18n';
import { Dialog, IconButton, Popover, TextField } from '../../ui';
import { ToolButton } from './ToolButton';

type LabelProblem = 'invalid' | 'exists' | 'full';

/** What is shown for each problem: the key is kept (not the text), so a language switch changes a hint that is on screen. */
const LABEL_PROBLEM_KEYS: Record<LabelProblem, MessageKey> = {
  invalid: 'reader.label_invalid',
  exists: 'reader.label_exists',
  full: 'reader.label_limit'
};

/** Why `label` cannot be created (checked again by the server), or null when it can. */
function labelProblem(label: string, existing: string[], full: boolean): LabelProblem | null {
  if (!LABEL_NAME_PATTERN.test(label)) {
    return 'invalid';
  }
  if (existing.some((name) => name.toLowerCase() === label.toLowerCase())) {
    return 'exists';
  }
  return full ? 'full' : null;
}

interface NewLabelRowProps {
  /** Every label already listed. */
  existing: string[];
  /** The open message already has the most labels it may have. */
  full: boolean;
  onCreate: (name: string) => void;
}

/** Last row of the label picker: type a name, press Enter (or the button) to create it and put it on the open message. */
const NewLabelRow: React.FC<NewLabelRowProps> = ({ existing, full, onCreate }) => {
  const tr = useT();
  const [name, setName] = React.useState('');
  const [hint, setHint] = React.useState<LabelProblem | null>(null);
  // maxLength cuts a longer paste; this says so instead of leaving the field short without a word.
  const atLimit = name.length >= LABEL_NAME_MAX;
  const describedBy = hint === null ? (atLimit ? 'new-label-limit' : undefined) : 'new-label-hint';

  const submit = (event: React.SyntheticEvent) => {
    event.preventDefault();
    const label = name.trim();
    if (label === '') {
      return;
    }
    const problem = labelProblem(label, existing, full);
    setHint(problem);
    if (problem === null) {
      onCreate(label);
      setName('');
    }
  };

  return (
    <form onSubmit={submit} className="rd-new" data-list={existing.length > 0 ? 'true' : undefined}>
      <div className="rd-new-row">
        <TextField
          label={tr('reader.new_label')}
          hideLabel
          placeholder={tr('reader.new_label')}
          autoComplete="off"
          maxLength={LABEL_NAME_MAX}
          value={name}
          aria-invalid={hint !== null}
          aria-describedby={describedBy}
          onChange={(e) => {
            setName(e.target.value);
            setHint(null);
          }}
        />
        {/* Never disabled (a disabled button cannot say why): an empty name does nothing. */}
        <IconButton type="submit" variant="primary" label={tr('reader.create_label')}>
          <Plus size={16} strokeWidth={1.75} aria-hidden="true" />
        </IconButton>
      </div>
      {hint === null ? (
        atLimit ? (
          <p id="new-label-limit" className="rd-new-hint">
            {tr('reader.label_name_limit', { max: LABEL_NAME_MAX })}
          </p>
        ) : null
      ) : (
        <p id="new-label-hint" role="alert" className="rd-new-hint" data-tone="danger">
          <CircleAlert size={14} strokeWidth={1.75} aria-hidden="true" />
          <span>{tr(LABEL_PROBLEM_KEYS[hint], { max: MAX_LABELS_PER_MESSAGE })}</span>
        </p>
      )}
    </form>
  );
};

interface LabelPickerProps {
  t: ThemeTokens;
  open: boolean;
  /** The control the picker hangs from (the Label button, or the phone's More button). */
  anchorRef: React.RefObject<HTMLElement | null>;
  /** Escape, Tab out and a press outside close it; only the keys give focus back (`returnFocus`). */
  onClose: () => void;
  /** Puts focus back where the picker came from (its button), when it closes from the keyboard. */
  returnFocus: () => void;
  /** Move focus into the picker when it opens (a keyboard open, or an open from a menu). */
  focusIn: boolean;
  /** A phone: the picker is a bottom sheet (a modal ui Dialog: full width, grab handle, scrim, 44 px rows) instead of a popover. */
  sheet?: boolean;
  message: Message;
  labels: string[];
  onToggleLabel: (message: Message, label: string) => void;
}

/**
 * The label picker: a small non-modal dialog (it holds a field, so it is not an ARIA menu) with a checkbox per label and the row that
 * creates a new one. Up and Down move between the labels, Home and End jump (the field keeps those keys for its caret). It is a Popover
 * (drawn in the body, kept inside the window): it closes on Escape (focus goes back), on a press outside it, when Tab leaves its first or
 * last control (focus goes on from the button), and when the window loses focus to the mail frame.
 */
export const LabelPicker: React.FC<LabelPickerProps> = ({
  t,
  open,
  anchorRef,
  onClose,
  returnFocus,
  focusIn,
  sheet = false,
  message,
  labels,
  onToggleLabel
}) => {
  const tr = useT();
  const menuRef = React.useRef<HTMLDivElement | null>(null);
  const sheetRef = React.useRef<HTMLDivElement | null>(null);
  const messageLabels = labelsOf(message);

  React.useEffect(() => {
    if (!open) {
      return;
    }
    // The body iframe is sandboxed (opaque origin), so its clicks never reach this document;
    // the window losing focus to the iframe is the only signal.
    const onWindowBlur = () => {
      if (document.activeElement instanceof HTMLIFrameElement) {
        onClose();
      }
    };
    window.addEventListener('blur', onWindowBlur);
    return () => window.removeEventListener('blur', onWindowBlur);
  }, [open, onClose]);

  // The picker is drawn after the toolbar in Tab order, so a keyboard open moves focus into it (the first label, or the field when there are none).
  // The phone's sheet is a modal dialog that places focus itself (J3-25: on the sheet, not on its first row).
  React.useEffect(() => {
    if (open && focusIn && !sheet) {
      menuRef.current?.querySelector<HTMLElement>('[role="checkbox"], input')?.focus();
    }
  }, [open, focusIn, sheet]);

  const items = (): HTMLElement[] => [...(menuRef.current?.querySelectorAll<HTMLElement>('[role="checkbox"]') ?? [])];

  const onMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    switch (event.key) {
      case 'Tab': {
        // Tab leaving the first or last control closes the picker and goes on from the button (the sheet keeps Tab inside: it is modal).
        if (sheet) {
          break;
        }
        const controls = [...(menuRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input') ?? [])];
        if (event.target === (event.shiftKey ? controls.at(0) : controls.at(-1))) {
          onClose();
          returnFocus();
        }
        break;
      }
      case 'ArrowDown':
      case 'ArrowUp': {
        // The arrows move between the labels; in the field of a new label they belong to the field.
        const list = items();
        const index = list.indexOf(document.activeElement as HTMLElement);
        if (index !== -1) {
          event.preventDefault();
          // at(-1) is the last item, so Up from the first item wraps around.
          list.at((index + (event.key === 'ArrowDown' ? 1 : -1)) % list.length)?.focus();
        }
        break;
      }
      case 'Home':
      case 'End': {
        // Home and End jump to the first and the last label (as in ui/Menu); in the field of a new label they move the caret.
        const list = items();
        if (list.includes(document.activeElement as HTMLElement)) {
          event.preventDefault();
          list.at(event.key === 'Home' ? 0 : -1)?.focus();
        }
        break;
      }
      default: {
        // Every other key belongs to the control that has focus.
        break;
      }
    }
  };

  const body = (
    <div ref={menuRef} className="rd-menu-body">
      {/* The popover names itself, as Snooze's does (the sheet has its own title). */}
      {sheet ? null : (
        <p aria-hidden="true" className="rd-pop-title">
          {tr('reader.labels')}
        </p>
      )}
      {labels.length > 0 ? (
        <div role="group" aria-label={tr('reader.labels')} className="rd-menu-list">
          {labels.map((label) => {
            const on = messageLabels.includes(label);
            const chip = getLabelChip(label, t);
            // J4-42: each label is a checkbox, ticked while the message has it: a press takes it off as plainly as it puts it on, and says so.
            // (The picker holds a field, so it is a dialog of checkboxes, not an ARIA menu of menuitemcheckbox: DESIGN 4.5.)
            return (
              <button
                key={label}
                type="button"
                role="checkbox"
                className="ui-menu-item rd-menu-item"
                aria-checked={on}
                onClick={() => {
                  onToggleLabel(message, label);
                  announce(tr(on ? 'reader.label_removed' : 'reader.label_applied', { label }));
                }}
              >
                <span aria-hidden="true" className="rd-check" data-on={on ? 'true' : undefined}>
                  {on ? <Check size={12} strokeWidth={2.5} /> : null}
                </span>
                <span aria-hidden="true" className="rd-dot" style={{ background: chip.dot }} />
                <span className="rd-menu-name">{label}</span>
              </button>
            );
          })}
        </div>
      ) : null}
      <NewLabelRow
        existing={labels}
        full={messageLabels.length >= MAX_LABELS_PER_MESSAGE}
        onCreate={(name) => onToggleLabel(message, name)}
      />
    </div>
  );

  if (sheet) {
    // A modal sheet: Tab stays inside, Escape and the scrim close it, and focus goes back to what opened it (the More button). It opens from
    // a touch on the More menu: the sheet itself takes focus, so its first label is not painted as if chosen (J3-25).
    return (
      <Dialog
        ref={sheetRef}
        open={open}
        onClose={onClose}
        title={tr('reader.labels')}
        size="sm"
        className="rd-sheet rd-label-sheet"
        initialFocusRef={sheetRef}
      >
        {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions -- the arrow keys between the labels, as in the popover */}
        <div onKeyDown={onMenuKeyDown}>{body}</div>
      </Dialog>
    );
  }

  return (
    <Popover
      open={open}
      anchorRef={anchorRef}
      align="end"
      onClose={(reason) => {
        onClose();
        if (reason === 'escape') {
          returnFocus();
        }
      }}
      role="dialog"
      aria-label={tr('reader.labels')}
      className="rd-menu"
      onKeyDown={onMenuKeyDown}
    >
      {body}
    </Popover>
  );
};

interface LabelMenuProps {
  t: ThemeTokens;
  message: Message;
  /** Every label the person has. */
  labels: string[];
  onToggleLabel: (message: Message, label: string) => void;
  /** The toolbar's icon size in px, so the button matches its neighbours. */
  iconSize: number;
  /** The toolbar is wide enough for words: the button says "Labels" beside its icon (J4-42: it puts labels on and takes them off). */
  labelled?: boolean;
  /** The next message is on its way: the button stays where it is, but does nothing until it is there. */
  disabled?: boolean;
  /** Its single-key shortcut ("L") for the tooltip and aria-keyshortcuts, while single-key shortcuts are on (J6-31). */
  shortcut?: string;
}

/**
 * The Label button of the reader toolbar and the picker it opens. It is not keyed by the message: the button stays the same element when
 * the next message opens (focus stays on it), and the picker closes when the message changes.
 */
export const LabelMenu: React.FC<LabelMenuProps> = ({
  t,
  message,
  labels,
  onToggleLabel,
  iconSize,
  labelled = false,
  disabled = false,
  shortcut
}) => {
  const tr = useT();
  const [open, setOpen] = React.useState(false);
  /** Opened from the keyboard: the first item takes focus. A pointer or touch open leaves focus where it is. */
  const [viaKeyboard, setViaKeyboard] = React.useState(false);
  const buttonRef = React.useRef<HTMLButtonElement | null>(null);
  // A new message starts with the picker closed (adjusted while rendering: the message is what it follows).
  const [shownFor, setShownFor] = React.useState(message.id);
  if (shownFor !== message.id) {
    setShownFor(message.id);
    setOpen(false);
  }
  const close = React.useCallback(() => setOpen(false), []);
  const returnFocus = React.useCallback(() => buttonRef.current?.focus(), []);

  // A pointer or touch open leaves focus on the button: Down enters the picker at its first label, Up at its last.
  const onButtonKeyDown = (event: React.KeyboardEvent) => {
    if (open && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault();
      event.stopPropagation();
      const list = [...document.querySelectorAll<HTMLElement>('.rd-menu [role="checkbox"]')];
      list.at(event.key === 'ArrowDown' ? 0 : -1)?.focus();
    }
  };

  return (
    <div className="rd-lm">
      <ToolButton
        ref={buttonRef}
        label={tr('reader.labels')}
        labelled={labelled}
        shortcut={shortcut}
        disabled={disabled}
        icon={<Tag size={iconSize} strokeWidth={1.75} aria-hidden="true" />}
        aria-haspopup="dialog"
        aria-expanded={open}
        onKeyDown={onButtonKeyDown}
        onClick={(event) => {
          // A click that came from the keyboard has no pointer position (detail 0).
          setViaKeyboard(event.detail === 0);
          setOpen((v) => !v);
        }}
      />
      <LabelPicker
        t={t}
        open={open}
        anchorRef={buttonRef}
        onClose={close}
        returnFocus={returnFocus}
        focusIn={viaKeyboard}
        message={message}
        labels={labels}
        onToggleLabel={onToggleLabel}
      />
    </div>
  );
};
