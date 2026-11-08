import React from 'react';
import { Check, CircleAlert, Plus, Tag } from 'lucide-react';
import type { Message } from '../../types';
import type { ThemeTokens } from '../../theme';
import { getLabelChip } from '../../theme';
import { LABEL_NAME_MAX, LABEL_NAME_PATTERN, MAX_LABELS_PER_MESSAGE, labelsOf } from '../../lib/mail';
import { useT, type MessageKey } from '../../lib/i18n';
import { IconButton, Popover, TextField } from '../../ui';

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
  /** Every label already listed in the menu. */
  existing: string[];
  /** The open message already has the most labels it may have. */
  full: boolean;
  onCreate: (name: string) => void;
}

/** Last row of the label menu: type a name, press Enter (or the button) to create it and put it on the open message. */
const NewLabelRow: React.FC<NewLabelRowProps> = ({ existing, full, onCreate }) => {
  const tr = useT();
  const [name, setName] = React.useState('');
  const [hint, setHint] = React.useState<LabelProblem | null>(null);
  const blank = name.trim() === '';
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
        <IconButton type="submit" variant="primary" label={tr('reader.create_label')} disabled={blank}>
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

interface LabelMenuProps {
  t: ThemeTokens;
  message: Message;
  /** Every label the person has. */
  labels: string[];
  onToggleLabel: (message: Message, label: string) => void;
  /** The toolbar's icon size in px, so the button matches its neighbours. */
  iconSize: number;
}

/**
 * The label button of the reader toolbar and the menu it opens: tick the labels the message has, or type a new one. Mount it with
 * `key={message.id}`: a new mail starts with the menu closed. The menu is a Popover (drawn in the body, so the pane never clips it, and kept
 * inside the window): it closes on Escape (focus goes back to the button), on a press outside it (a tap on a touch screen, which has no hover or
 * blur), and when the window loses focus to the mail frame.
 */
export const LabelMenu: React.FC<LabelMenuProps> = ({ t, message, labels, onToggleLabel, iconSize }) => {
  const tr = useT();
  const [open, setOpen] = React.useState(false);
  /** Opened from the keyboard: the first item takes focus. A pointer or touch open leaves focus where it is. */
  const [viaKeyboard, setViaKeyboard] = React.useState(false);
  const buttonRef = React.useRef<HTMLButtonElement | null>(null);
  const menuRef = React.useRef<HTMLDivElement | null>(null);
  const messageLabels = labelsOf(message);

  React.useEffect(() => {
    if (!open) {
      return;
    }
    // The body iframe is sandboxed (opaque origin), so its clicks never reach this document;
    // the window losing focus to the iframe is the only signal.
    const onWindowBlur = () => {
      if (document.activeElement instanceof HTMLIFrameElement) {
        setOpen(false);
      }
    };
    window.addEventListener('blur', onWindowBlur);
    return () => window.removeEventListener('blur', onWindowBlur);
  }, [open]);

  // The menu is drawn after the toolbar in Tab order, so a keyboard open moves focus into it (the first label, or the field when there are none).
  React.useEffect(() => {
    if (open && viaKeyboard) {
      menuRef.current?.querySelector<HTMLElement>('[role="menuitemcheckbox"], input')?.focus();
    }
  }, [open, viaKeyboard]);

  const items = (): HTMLElement[] => [...(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitemcheckbox"]') ?? [])];

  // A pointer or touch open leaves focus on the button: Down enters the menu at its first item, Up at its last.
  const onButtonKeyDown = (event: React.KeyboardEvent) => {
    if (open && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault();
      items()
        .at(event.key === 'ArrowDown' ? 0 : -1)
        ?.focus();
    }
  };

  const onMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    switch (event.key) {
      case 'Tab': {
        // Tab leaving the first or last control closes the menu and goes on from the button.
        const controls = [...(menuRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input') ?? [])];
        if (event.target === (event.shiftKey ? controls.at(0) : controls.at(-1))) {
          setOpen(false);
          buttonRef.current?.focus();
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

  return (
    <div className="rd-lm">
      <IconButton
        ref={buttonRef}
        label={tr('reader.add_label')}
        size="sm"
        aria-haspopup="menu"
        aria-expanded={open}
        onKeyDown={onButtonKeyDown}
        onClick={(event) => {
          // A click that came from the keyboard has no pointer position (detail 0).
          setViaKeyboard(event.detail === 0);
          setOpen((v) => !v);
        }}
      >
        <Tag size={iconSize} strokeWidth={1.75} aria-hidden="true" />
      </IconButton>
      <Popover
        open={open}
        anchorRef={buttonRef}
        onClose={(reason) => {
          setOpen(false);
          if (reason === 'escape') {
            buttonRef.current?.focus();
          }
        }}
        role="menu"
        aria-label={tr('reader.add_label')}
        className="rd-menu"
        onKeyDown={onMenuKeyDown}
      >
        <div ref={menuRef} className="rd-menu-body">
          <div className="rd-menu-list">
            {labels.map((label) => {
              const on = messageLabels.includes(label);
              const chip = getLabelChip(label, t);
              return (
                <button
                  key={label}
                  type="button"
                  role="menuitemcheckbox"
                  className="ui-menu-item rd-menu-item"
                  aria-checked={on}
                  onClick={() => onToggleLabel(message, label)}
                >
                  <span aria-hidden="true" className="rd-dot" style={{ background: chip.dot }} />
                  <span className="rd-menu-name">{label}</span>
                  {on ? (
                    <span className="rd-menu-on">
                      <Check size={14} strokeWidth={2} aria-hidden="true" />
                      {tr('reader.label_added')}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
          <NewLabelRow
            existing={labels}
            full={messageLabels.length >= MAX_LABELS_PER_MESSAGE}
            onCreate={(name) => onToggleLabel(message, name)}
          />
        </div>
      </Popover>
    </div>
  );
};
