import React from 'react';
import { AlarmClockOff, CalendarClock, CircleAlert, Clock } from 'lucide-react';
import type { ThemeTokens } from '../theme';
import { useT } from '../lib/i18n';
import {
  MAX_SNOOZE_MS,
  MIN_SNOOZE_MS,
  formatSnoozeUntil,
  parseLocalInput,
  snoozePresets,
  snoozeProblem,
  toLocalInputValue,
  tomorrowMorning,
  type SnoozePreset
} from '../lib/snooze';
import { Button, Chip, Dialog, Popover, TextField } from '../ui';
import { ToolButton } from './reader/ToolButton';
import './messagelist.css';

interface OpenMenu {
  presets: SnoozePreset[];
  /** When the popup opened; the custom picker's limits are measured from it. */
  now: Date;
  /** Opened from the keyboard: the first choice takes focus (and its focus ring shows). A pointer or touch open leaves focus where it is. */
  viaKeyboard: boolean;
}

interface SnoozeMenuProps {
  t: ThemeTokens;
  /** The look of the other reader toolbar buttons. */
  buttonStyle: React.CSSProperties;
  /** The mail is snoozed already: the button brings it back at once instead of opening the choices. */
  snoozed: boolean;
  onSnooze: (until: Date) => void;
  onUnsnooze: () => void;
  /** Size of the clock icon in px, so it matches the other buttons of the toolbar it sits in. Default: 20. */
  iconSize?: number;
  /** The toolbar has room for words: the button says "Snooze" beside its clock. */
  labelled?: boolean;
  /** The size of the button (the phone's bottom bar uses md: 44 px there). Default: sm. */
  size?: 'sm' | 'md';
  /** The phone's bottom bar: the short word under the clock, and the choices open as a bottom sheet (ui Dialog) that always fits. */
  short?: string;
  /** The next message is on its way: the button stays where it is, but does nothing until it is there. */
  disabled?: boolean;
  /** Its single-key shortcut ("B") for the tooltip and aria-keyshortcuts, while single-key shortcuts are on (J6-31). */
  shortcut?: string;
}

/**
 * Reader toolbar button that snoozes the open mail (quick times or a picked date), or unsnoozes it when it is snoozed. The choices open in a
 * small non-modal dialog (it holds a date field, so it is not an ARIA menu): Up and Down move between the quick times, the date field keeps
 * its own keys. On a phone (`short`) they open as a bottom sheet instead (a modal ui Dialog: full width, grab handle, scrim, 44 px rows), with
 * Snooze of a picked date in its footer, so the confirm button is always on screen. It is not keyed by the message: after a choice, focus
 * goes back to this button, which stays the same element while the next message opens.
 */
export const SnoozeMenu: React.FC<SnoozeMenuProps> = ({
  buttonStyle,
  snoozed,
  onSnooze,
  onUnsnooze,
  iconSize = 20,
  labelled = false,
  size = 'sm',
  short,
  disabled = false,
  shortcut
}) => {
  const tr = useT();
  const sheet = short !== undefined;
  const [menu, setMenu] = React.useState<OpenMenu | null>(null);
  const [picking, setPicking] = React.useState(false);
  const [pick, setPick] = React.useState('');
  const [problem, setProblem] = React.useState<string | null>(null);
  const buttonRef = React.useRef<HTMLButtonElement | null>(null);
  const menuRef = React.useRef<HTMLDivElement | null>(null);
  const formRef = React.useRef<HTMLFormElement | null>(null);
  const pickId = React.useId();
  const formId = `${pickId}-form`;
  const isOpen = menu !== null;

  // The Popover closes the choices on Escape and on a press outside it (the sheet: Escape and its scrim). These are the rest of the closing
  // rules, and the arrow keys: the window losing focus to the mail iframe, a resize (not for the sheet: a phone's keyboard resizes the
  // window), and the arrows between the quick times.
  React.useEffect(() => {
    if (!isOpen) {
      return;
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const items = [...(menuRef.current?.querySelectorAll<HTMLElement>('[data-snooze-choice]') ?? [])];
        const active = document.activeElement;
        const index = items.indexOf(active as HTMLElement);
        if (index !== -1) {
          e.preventDefault();
          // at(-1) is the last item, so Up from the first item wraps around.
          items.at((index + (e.key === 'ArrowDown' ? 1 : -1)) % items.length)?.focus();
        } else if (active === buttonRef.current) {
          // A mouse or touch open leaves focus on the button: Down enters the choices at the first one, Up at the last.
          e.preventDefault();
          items.at(e.key === 'ArrowDown' ? 0 : -1)?.focus();
        }
        // Otherwise focus is in the date field (or nowhere): the arrow keys belong to that field.
      }
    };
    // The body iframe is sandboxed (opaque origin), so its clicks never reach this document;
    // the window losing focus to the iframe is the only signal.
    const onWindowBlur = () => {
      if (document.activeElement instanceof HTMLIFrameElement) {
        setMenu(null);
      }
    };
    const onResize = () => setMenu(null);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('blur', onWindowBlur);
    if (!sheet) {
      window.addEventListener('resize', onResize);
    }
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('blur', onWindowBlur);
      window.removeEventListener('resize', onResize);
    };
  }, [isOpen, sheet]);

  // Keyboard users land on the first choice. A pointer or touch open does not move focus: a ring on an item nobody asked for looks like a
  // selection. (The sheet is a modal dialog: it takes focus itself.)
  const viaKeyboard = menu?.viaKeyboard === true;
  React.useEffect(() => {
    if (isOpen && viaKeyboard && !sheet) {
      menuRef.current?.querySelector<HTMLElement>('[data-snooze-choice]')?.focus();
    }
  }, [isOpen, viaKeyboard, sheet]);

  // The date-time form opens below the choices; the list is capped in height, so bring the field and the button into view, and the field takes focus.
  React.useEffect(() => {
    if (picking) {
      formRef.current?.scrollIntoView({ block: 'nearest' });
      formRef.current?.querySelector<HTMLInputElement>('input')?.focus();
    }
  }, [picking]);

  // Set by the button's pointerdown, read (and cleared) by its click: a click without one came from the keyboard.
  const pointerOpen = React.useRef(false);

  const toggle = () => {
    const viaPointer = pointerOpen.current;
    pointerOpen.current = false;
    if (menu !== null) {
      setMenu(null);
      return;
    }
    if (buttonRef.current === null) {
      return;
    }
    const now = new Date();
    setPicking(false);
    setProblem(null);
    setPick(toLocalInputValue(tomorrowMorning(now)));
    setMenu({ presets: snoozePresets(now), now, viaKeyboard: !viaPointer });
  };

  const choose = (at: Date) => {
    // Focus goes back to the button before the popup goes, so it is never lost while the next message opens.
    buttonRef.current?.focus({ preventScroll: true });
    setMenu(null);
    onSnooze(at);
  };

  const submit = (event: React.SyntheticEvent) => {
    event.preventDefault();
    const at = parseLocalInput(pick);
    const message = snoozeProblem(at, new Date());
    setProblem(message);
    if (message === null && at !== null) {
      choose(at);
    }
  };

  // The popup lives in the body (a Popover), after the toolbar in Tab order: Tab leaving its first or last control closes it and goes on from the button.
  const onMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab') {
      return;
    }
    const controls = [...(menuRef.current?.querySelectorAll<HTMLElement>('button, input') ?? [])];
    if (event.target === (event.shiftKey ? controls.at(0) : controls.at(-1))) {
      setMenu(null);
      buttonRef.current?.focus();
    }
  };

  const label = snoozed ? tr('action.unsnooze') : tr('action.snooze');

  const choices =
    menu === null || sheet ? null : (
      <div ref={menuRef}>
        <p className="rd-pop-title">{tr('snooze.menu_label')}</p>
        {menu.presets.map((preset) => (
          <button
            key={preset.id}
            type="button"
            data-snooze-choice=""
            className="ui-menu-item ml-snooze-item"
            onClick={() => choose(preset.at)}
          >
            <span>{preset.label}</span>
            <span className="ml-snooze-hint">{preset.hint}</span>
          </button>
        ))}
        <div role="separator" className="ui-menu-sep" />
        <button
          type="button"
          data-snooze-choice=""
          aria-expanded={picking}
          className="ui-menu-item ml-snooze-item"
          onClick={() => setPicking(true)}
        >
          <span>{tr('snooze.pick_date_time')}</span>
          {/* J3-39: once the field is open it carries the calendar itself: one calendar glyph, not two. */}
          {picking ? null : <CalendarClock size={16} strokeWidth={1.75} aria-hidden="true" />}
        </button>
        {picking ? (
          <form id={formId} ref={formRef} noValidate onSubmit={submit} className="ml-snooze-form rd-snooze-form">
            <TextField
              id={pickId}
              type="datetime-local"
              label={tr('snooze.date_time_label')}
              hideLabel
              value={pick}
              min={toLocalInputValue(new Date(menu.now.getTime() + MIN_SNOOZE_MS))}
              max={toLocalInputValue(new Date(menu.now.getTime() + MAX_SNOOZE_MS))}
              aria-invalid={problem !== null}
              aria-describedby={problem === null ? (parseLocalInput(pick) === null ? undefined : `${pickId}-when`) : `${pickId}-problem`}
              onChange={(e) => {
                setPick(e.target.value);
                setProblem(null);
              }}
            />
            {problem === null ? (
              <PickedTime id={`${pickId}-when`} value={pick} />
            ) : (
              <p id={`${pickId}-problem`} role="alert" className="ml-snooze-problem">
                <CircleAlert size={14} strokeWidth={1.75} aria-hidden="true" />
                <span>{problem}</span>
              </p>
            )}
            <Button type="submit" variant="primary" fullWidth>
              {tr('action.snooze')}
            </Button>
          </form>
        ) : null}
      </div>
    );

  return (
    <div className="ml-snooze">
      <ToolButton
        ref={buttonRef}
        label={label}
        labelled={labelled}
        size={size}
        short={short}
        shortcut={snoozed ? undefined : shortcut}
        disabled={disabled}
        icon={
          snoozed ? (
            <AlarmClockOff size={iconSize} strokeWidth={1.75} aria-hidden="true" />
          ) : (
            <Clock size={iconSize} strokeWidth={1.75} aria-hidden="true" />
          )
        }
        className="nm-tap"
        aria-haspopup={snoozed ? undefined : 'dialog'}
        aria-expanded={snoozed ? undefined : isOpen}
        onPointerDown={() => {
          pointerOpen.current = true;
        }}
        onKeyDown={() => {
          pointerOpen.current = false;
        }}
        onClick={snoozed ? onUnsnooze : toggle}
        style={buttonStyle}
      />
      {sheet ? (
        <SnoozeSheet
          opened={menu?.now ?? null}
          onClose={() => setMenu(null)}
          onSnooze={choose}
          viaKeyboard={viaKeyboard}
          returnFocusRef={buttonRef}
        />
      ) : (
        <Popover
          open={isOpen}
          anchorRef={buttonRef}
          onClose={(reason) => {
            setMenu(null);
            if (reason === 'escape') {
              buttonRef.current?.focus();
            }
          }}
          role="dialog"
          aria-label={tr('snooze.menu_label')}
          className="ml-snooze-pop"
          onKeyDown={onMenuKeyDown}
        >
          {choices}
        </Popover>
      )}
    </div>
  );
};

/**
 * J3-39: the picked time said in the app's own words under the field ("Until Tue, Nov 17, 8:00 AM", as the quick times above it), whatever the
 * browser's field shows; nothing while the field holds no whole date.
 */
function PickedTime({ id, value }: { id: string; value: string }): React.ReactElement | null {
  const tr = useT();
  const at = parseLocalInput(value);
  return at === null ? null : (
    <p id={id} className="rd-snooze-when">
      {tr('snooze.until', { when: formatSnoozeUntil(at.getTime()) })}
    </p>
  );
}

interface SnoozeSheetProps {
  /** When it was opened (the quick times and the limits of a picked time are measured from it); null: closed, nothing is mounted. */
  opened: Date | null;
  onClose: () => void;
  /** A time was chosen: the sheet closes first, then this runs. */
  onSnooze: (until: Date) => void;
  /** Where focus goes when it closes and the element that opened it is gone. */
  returnFocusRef?: React.RefObject<HTMLElement | null>;
  /** Opened from the keyboard: its first row takes focus. Opened by a touch, the sheet itself does (no row painted as if chosen, J3-25). */
  viaKeyboard?: boolean;
}

/** Up and Down move between the rows of the Snooze sheet and wrap (in the date field they are the field's). */
function moveBetweenChoices(event: React.KeyboardEvent<HTMLButtonElement>): void {
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') {
    return;
  }
  const rows = [...(event.currentTarget.parentElement?.querySelectorAll<HTMLElement>('[data-snooze-choice]') ?? [])];
  const index = rows.indexOf(event.currentTarget);
  event.preventDefault();
  rows.at((index + (event.key === 'ArrowDown' ? 1 : -1)) % rows.length)?.focus();
}

/**
 * The choices of Snooze as a phone's bottom sheet (a modal ui Dialog: full width, grab handle, scrim, 44 px rows): the quick times with
 * their day and hour, then a picked date and time with Snooze in the footer, so the confirm button is always on screen. The reader's Snooze
 * button (`short`) and the phone selection bar's More sheet open it: the same choices as the desktop's Snooze.
 */
export function SnoozeSheet({ opened, ...rest }: SnoozeSheetProps): React.ReactElement | null {
  return opened === null ? null : <OpenSnoozeSheet opened={opened} {...rest} />;
}

function OpenSnoozeSheet({
  opened,
  onClose,
  onSnooze,
  returnFocusRef,
  viaKeyboard = false
}: SnoozeSheetProps & { opened: Date }): React.ReactElement {
  const tr = useT();
  const sheetRef = React.useRef<HTMLDivElement | null>(null);
  const formRef = React.useRef<HTMLFormElement | null>(null);
  const pickId = React.useId();
  const formId = `${pickId}-form`;
  const presets = React.useMemo(() => snoozePresets(opened), [opened]);
  const [picking, setPicking] = React.useState(false);
  const [pick, setPick] = React.useState(() => toLocalInputValue(tomorrowMorning(opened)));
  const [problem, setProblem] = React.useState<string | null>(null);

  // The date field opens below the times: bring it into view and give it focus.
  React.useEffect(() => {
    if (picking) {
      formRef.current?.scrollIntoView({ block: 'nearest' });
      formRef.current?.querySelector<HTMLInputElement>('input')?.focus();
    }
  }, [picking]);

  const choose = (at: Date) => {
    onClose();
    onSnooze(at);
  };
  const submit = (event: React.SyntheticEvent) => {
    event.preventDefault();
    const at = parseLocalInput(pick);
    const message = snoozeProblem(at, new Date());
    setProblem(message);
    if (message === null && at !== null) {
      choose(at);
    }
  };

  return (
    <Dialog
      ref={sheetRef}
      open
      onClose={onClose}
      title={tr('snooze.menu_label')}
      size="sm"
      className="rd-sheet"
      returnFocusRef={returnFocusRef}
      initialFocusRef={viaKeyboard ? undefined : sheetRef}
      footer={
        picking ? (
          <Button type="submit" form={formId} variant="primary" fullWidth>
            {tr('action.snooze')}
          </Button>
        ) : undefined
      }
    >
      <div className="rd-sheet-list">
        {presets.map((preset) => (
          <button
            key={preset.id}
            type="button"
            data-snooze-choice=""
            className="ui-menu-item rd-sheet-item"
            onKeyDown={moveBetweenChoices}
            onClick={() => choose(preset.at)}
          >
            <span>{preset.label}</span>
            <span className="rd-sheet-hint">{preset.hint}</span>
          </button>
        ))}
        <div role="separator" className="ui-menu-sep" />
        <button
          type="button"
          data-snooze-choice=""
          aria-expanded={picking}
          className="ui-menu-item rd-sheet-item"
          onKeyDown={moveBetweenChoices}
          onClick={() => setPicking(true)}
        >
          <span>{tr('snooze.pick_date_time')}</span>
          {picking ? null : <CalendarClock size={16} strokeWidth={1.75} aria-hidden="true" />}
        </button>
        {picking ? (
          <form id={formId} ref={formRef} noValidate onSubmit={submit} className="rd-sheet-form rd-snooze-form">
            <TextField
              id={pickId}
              type="datetime-local"
              label={tr('snooze.date_time_label')}
              hideLabel
              value={pick}
              min={toLocalInputValue(new Date(opened.getTime() + MIN_SNOOZE_MS))}
              max={toLocalInputValue(new Date(opened.getTime() + MAX_SNOOZE_MS))}
              aria-invalid={problem !== null}
              aria-describedby={problem === null ? (parseLocalInput(pick) === null ? undefined : `${pickId}-when`) : `${pickId}-problem`}
              onChange={(e) => {
                setPick(e.target.value);
                setProblem(null);
              }}
            />
            {problem === null ? (
              <PickedTime id={`${pickId}-when`} value={pick} />
            ) : (
              <p id={`${pickId}-problem`} role="alert" className="ml-snooze-problem">
                <CircleAlert size={14} strokeWidth={1.75} aria-hidden="true" />
                <span>{problem}</span>
              </p>
            )}
          </form>
        ) : null}
      </div>
    </Dialog>
  );
}

interface SnoozeChipProps {
  t: ThemeTokens;
  /** Wake time, epoch ms. */
  until: number;
  /** No border or padding: the phone list row sets it in its meta line. */
  bare?: boolean;
  /** The chip sits on the selected list row, whose tint swallows the plain border in dark mode. */
  selected?: boolean;
}

/** Muted "Until tomorrow 8:00 AM" chip with a clock, for mail in the Snoozed folder. */
export const SnoozeChip: React.FC<SnoozeChipProps> = ({ until, bare = false, selected = false }) => {
  const tr = useT();
  return (
    <Chip icon={<Clock size={12} strokeWidth={2} />} data-bare={bare ? 'true' : undefined} data-selected={selected ? 'true' : undefined}>
      {tr('snooze.until', { when: formatSnoozeUntil(until) })}
    </Chip>
  );
};
