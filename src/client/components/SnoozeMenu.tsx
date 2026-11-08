import React from 'react';
import { AlarmClockOff, CircleAlert, Clock } from 'lucide-react';
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
import { Button, Chip, IconButton, Popover, TextField } from '../ui';
import './messagelist.css';

interface OpenMenu {
  presets: SnoozePreset[];
  /** When the menu opened; the custom picker's limits are measured from it. */
  now: Date;
  /** Opened from the keyboard: the first item takes focus (and its focus ring shows). A pointer or touch open leaves focus where it is. */
  viaKeyboard: boolean;
}

interface SnoozeMenuProps {
  t: ThemeTokens;
  /** The look of the other reader toolbar buttons. */
  buttonStyle: React.CSSProperties;
  /** The mail is snoozed already: the button brings it back at once instead of opening the menu. */
  snoozed: boolean;
  onSnooze: (until: Date) => void;
  onUnsnooze: () => void;
  /** Size of the clock icon in px, so it matches the other buttons of the toolbar it sits in. Default: 20. */
  iconSize?: number;
}

/** Reader toolbar button that snoozes the open mail (quick times or a picked date), or unsnoozes it when it is snoozed. */
export const SnoozeMenu: React.FC<SnoozeMenuProps> = ({ t, buttonStyle, snoozed, onSnooze, onUnsnooze, iconSize = 20 }) => {
  const tr = useT();
  const [menu, setMenu] = React.useState<OpenMenu | null>(null);
  const [picking, setPicking] = React.useState(false);
  const [pick, setPick] = React.useState('');
  const [problem, setProblem] = React.useState<string | null>(null);
  const buttonRef = React.useRef<HTMLButtonElement | null>(null);
  const menuRef = React.useRef<HTMLDivElement | null>(null);
  const formRef = React.useRef<HTMLFormElement | null>(null);
  const pickId = React.useId();
  const isOpen = menu !== null;

  // The Popover closes the menu on Escape and on a press outside it. These are the rest of the closing rules, and the arrow keys: the
  // window losing focus to the mail iframe, a resize, and the arrows between the items.
  React.useEffect(() => {
    if (!isOpen) {
      return;
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const items = [...(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
        const active = document.activeElement;
        const index = items.indexOf(active as HTMLElement);
        if (index !== -1) {
          e.preventDefault();
          // at(-1) is the last item, so Up from the first item wraps around.
          items.at((index + (e.key === 'ArrowDown' ? 1 : -1)) % items.length)?.focus();
        } else if (active === buttonRef.current) {
          // A mouse or touch open leaves focus on the button: Down enters the menu at its first item, Up at its last.
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
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('blur', onWindowBlur);
      window.removeEventListener('resize', onResize);
    };
  }, [isOpen]);

  // Keyboard users land on the first choice. A pointer or touch open does not move focus: a ring on an item nobody asked for looks like a selection.
  const viaKeyboard = menu?.viaKeyboard === true;
  React.useEffect(() => {
    if (isOpen && viaKeyboard) {
      menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    }
  }, [isOpen, viaKeyboard]);

  // The date-time form opens below the choices; the list is capped in height, so bring the field and the button into view.
  React.useEffect(() => {
    if (picking) {
      formRef.current?.scrollIntoView({ block: 'nearest' });
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

  // The menu lives in the body (a Popover), after the toolbar in Tab order: Tab leaving its first or last control closes it and goes on from the button.
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

  return (
    <div className="ml-snooze">
      <IconButton
        ref={buttonRef}
        label={label}
        size="sm"
        className="nm-tap"
        aria-haspopup={snoozed ? undefined : 'menu'}
        aria-expanded={snoozed ? undefined : isOpen}
        onPointerDown={() => {
          pointerOpen.current = true;
        }}
        onKeyDown={() => {
          pointerOpen.current = false;
        }}
        onClick={snoozed ? onUnsnooze : toggle}
        // Pressed while its menu is open, like the label button.
        style={isOpen ? { ...buttonStyle, background: t.hover } : buttonStyle}
      >
        {snoozed ? (
          <AlarmClockOff size={iconSize} strokeWidth={1.75} aria-hidden="true" />
        ) : (
          <Clock size={iconSize} strokeWidth={1.75} aria-hidden="true" />
        )}
      </IconButton>
      <Popover
        open={isOpen}
        anchorRef={buttonRef}
        onClose={(reason) => {
          setMenu(null);
          if (reason === 'escape') {
            buttonRef.current?.focus();
          }
        }}
        role="menu"
        aria-label={tr('snooze.menu_label')}
        className="ml-snooze-pop"
        onKeyDown={onMenuKeyDown}
      >
        {menu === null ? null : (
          <div ref={menuRef}>
            {menu.presets.map((preset) => (
              <button
                key={preset.id}
                type="button"
                role="menuitem"
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
              role="menuitem"
              aria-expanded={picking}
              className="ui-menu-item ml-snooze-item"
              onClick={() => setPicking(true)}
            >
              <span>{tr('snooze.pick_date_time')}</span>
            </button>
            {picking ? (
              <form ref={formRef} noValidate onSubmit={submit} className="ml-snooze-form">
                <TextField
                  id={pickId}
                  type="datetime-local"
                  label={tr('snooze.date_time_label')}
                  hideLabel
                  value={pick}
                  min={toLocalInputValue(new Date(menu.now.getTime() + MIN_SNOOZE_MS))}
                  max={toLocalInputValue(new Date(menu.now.getTime() + MAX_SNOOZE_MS))}
                  aria-invalid={problem !== null}
                  aria-describedby={problem === null ? undefined : `${pickId}-problem`}
                  onChange={(e) => {
                    setPick(e.target.value);
                    setProblem(null);
                  }}
                />
                {problem === null ? null : (
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
        )}
      </Popover>
    </div>
  );
};

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
