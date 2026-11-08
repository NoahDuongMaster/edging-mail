import React from 'react';
import { AlarmClockOff, Clock } from 'lucide-react';
import { mix, type ThemeTokens } from '../theme';
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

const MENU_WIDTH = 256;
/** Smallest gap kept between the menu and the viewport edge. */
const EDGE = 8;

interface OpenMenu {
  /** Viewport position: the card is fixed, so the reader's clipped edge cannot cut it off. */
  top: number;
  left: number;
  width: number;
  maxHeight: number;
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
}

/** Reader toolbar button that snoozes the open mail (quick times or a picked date), or unsnoozes it when it is snoozed. */
export const SnoozeMenu: React.FC<SnoozeMenuProps> = ({ t, buttonStyle, snoozed, onSnooze, onUnsnooze }) => {
  const tr = useT();
  const [menu, setMenu] = React.useState<OpenMenu | null>(null);
  const [picking, setPicking] = React.useState(false);
  const [pick, setPick] = React.useState('');
  const [problem, setProblem] = React.useState<string | null>(null);
  const wrapRef = React.useRef<HTMLDivElement | null>(null);
  const buttonRef = React.useRef<HTMLButtonElement | null>(null);
  const menuRef = React.useRef<HTMLDivElement | null>(null);
  const pickId = React.useId();
  const isOpen = menu !== null;

  // Same closing rules as the label menu: a tap outside, Escape, and the window losing focus to the mail iframe.
  React.useEffect(() => {
    if (!isOpen) {
      return;
    }
    const onPointerDown = (e: PointerEvent) => {
      if (wrapRef.current?.contains(e.target as Node) !== true) {
        setMenu(null);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMenu(null);
        buttonRef.current?.focus();
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
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
    // The card is placed in viewport coordinates when it opens, so a resize or rotation would leave it misplaced.
    const onResize = () => setMenu(null);
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('blur', onWindowBlur);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
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

  // Set by the button's pointerdown, read (and cleared) by its click: a click without one came from the keyboard.
  const pointerOpen = React.useRef(false);

  const toggle = () => {
    const viaPointer = pointerOpen.current;
    pointerOpen.current = false;
    if (menu !== null) {
      setMenu(null);
      return;
    }
    const rect = buttonRef.current?.getBoundingClientRect();
    if (rect === undefined) {
      return;
    }
    const now = new Date();
    const width = Math.min(MENU_WIDTH, window.innerWidth - 2 * EDGE);
    const top = rect.bottom + 4;
    setPicking(false);
    setProblem(null);
    setPick(toLocalInputValue(tomorrowMorning(now)));
    setMenu({
      top,
      // Under the button, but kept inside the viewport (on a phone the button sits too far right or left for a fixed side).
      left: Math.max(EDGE, Math.min(rect.left, window.innerWidth - width - EDGE)),
      width,
      maxHeight: window.innerHeight - top - EDGE,
      presets: snoozePresets(now),
      now,
      viaKeyboard: !viaPointer
    });
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

  const item: React.CSSProperties = {
    width: '100%',
    height: 40,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    padding: '0 10px',
    border: 0,
    borderRadius: 8,
    background: 'transparent',
    color: t.text,
    fontSize: 14,
    textAlign: 'left',
    cursor: 'pointer'
  };

  return (
    <div ref={wrapRef} style={{ display: 'flex' }}>
      <button
        ref={buttonRef}
        type="button"
        aria-label={snoozed ? tr('action.unsnooze') : tr('action.snooze')}
        title={snoozed ? tr('action.unsnooze') : tr('action.snooze')}
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
          <AlarmClockOff size={20} strokeWidth={1.8} aria-hidden="true" />
        ) : (
          <Clock size={20} strokeWidth={1.8} aria-hidden="true" />
        )}
      </button>
      {menu === null ? null : (
        <div
          ref={menuRef}
          role="menu"
          aria-label={tr('snooze.menu_label')}
          className="nm-fade-in"
          style={{
            position: 'fixed',
            top: menu.top,
            left: menu.left,
            zIndex: 20,
            width: menu.width,
            maxHeight: menu.maxHeight,
            overflowY: 'auto',
            padding: 6,
            borderRadius: 12,
            border: `1px solid ${t.border}`,
            background: t.surface,
            boxShadow: '0 12px 32px rgba(16,24,40,0.16)'
          }}
        >
          {menu.presets.map((preset) => (
            <button key={preset.id} type="button" role="menuitem" className="nm-tap-h" onClick={() => choose(preset.at)} style={item}>
              <span>{preset.label}</span>
              <span style={{ color: t.text2, fontSize: 13, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{preset.hint}</span>
            </button>
          ))}
          <div role="separator" style={{ height: 1, margin: '4px 6px', background: t.border }} />
          <button type="button" role="menuitem" aria-expanded={picking} className="nm-tap-h" onClick={() => setPicking(true)} style={item}>
            <span>{tr('snooze.pick_date_time')}</span>
          </button>
          {picking ? (
            <form noValidate onSubmit={submit} style={{ padding: '6px 6px 4px' }}>
              <label htmlFor={pickId} style={{ display: 'block', margin: '0 0 6px', fontSize: 12, lineHeight: '16px', color: t.text2 }}>
                {tr('snooze.date_time_label')}
              </label>
              <input
                id={pickId}
                type="datetime-local"
                className="nm-tap-h"
                value={pick}
                min={toLocalInputValue(new Date(menu.now.getTime() + MIN_SNOOZE_MS))}
                max={toLocalInputValue(new Date(menu.now.getTime() + MAX_SNOOZE_MS))}
                aria-invalid={problem !== null}
                aria-describedby={problem === null ? undefined : `${pickId}-problem`}
                onChange={(e) => {
                  setPick(e.target.value);
                  setProblem(null);
                }}
                style={{
                  width: '100%',
                  minWidth: 0,
                  height: 40,
                  padding: '0 10px',
                  border: `1px solid ${t.borderStrong}`,
                  borderRadius: 8,
                  background: t.surface,
                  color: t.text,
                  font: 'inherit',
                  fontSize: 16
                }}
              />
              {problem === null ? null : (
                <p
                  id={`${pickId}-problem`}
                  role="alert"
                  style={{ margin: '6px 2px 0', fontSize: 12, lineHeight: '16px', color: t.dark ? '#F97066' : '#B42318' }}
                >
                  {problem}
                </p>
              )}
              <button
                type="submit"
                className="nm-tap-h"
                style={{
                  width: '100%',
                  height: 40,
                  marginTop: 8,
                  border: 0,
                  borderRadius: 8,
                  background: t.accent,
                  color: '#FFFFFF',
                  font: 'inherit',
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                {tr('action.snooze')}
              </button>
            </form>
          ) : null}
        </div>
      )}
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
export const SnoozeChip: React.FC<SnoozeChipProps> = ({ t, until, bare = false, selected = false }) => {
  const tr = useT();
  return (
    <span
      style={{
        minWidth: 0,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        height: 22,
        padding: bare ? 0 : '0 8px',
        borderRadius: 6,
        border: bare ? 0 : `1px solid ${selected ? mix(t.text2, t.selBg, 0.6) : t.border}`,
        color: t.text2,
        fontSize: 12,
        lineHeight: '16px'
      }}
    >
      <Clock size={12} strokeWidth={2} aria-hidden="true" style={{ flex: 'none' }} />
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {tr('snooze.until', { when: formatSnoozeUntil(until) })}
      </span>
    </span>
  );
};
