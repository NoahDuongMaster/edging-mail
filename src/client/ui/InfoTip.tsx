import { Info } from 'lucide-react';
import React from 'react';
import { announce } from '../lib/announce';
import { useT } from '../lib/i18n';
import { cx } from './cx';
import { nodeText } from './nodeText';
import { Popover } from './Popover';

export interface InfoTipProps {
  /** What the tip explains (the field label, the title it sits after): the button is named "About {label}" (`ui.info_about`). */
  label: string;
  /** The explanation, shown in the bubble. Words only: the bubble holds no control (Tab never goes into it). */
  children: React.ReactNode;
  /** The id of the button; the bubble is `${id}-bubble`. Made up when left out. */
  id?: string;
  /** Where the bubble opens: under the glyph (default), above it, or `auto` (the side with more room). It flips when it does not fit. */
  placement?: 'below' | 'above' | 'auto';
  /** `md` (default): a 20 px glyph after a label or a title; `sm`: 16 px, after a line of small text. */
  size?: 'sm' | 'md';
  className?: string;
}

/** How long the mouse rests on the glyph before the bubble shows as a preview (a fine pointer only). */
export const INFO_TIP_HOVER_MS = 400;
/** How far the bubble starts before the glyph's left edge: its arrow then clears the bubble's rounded corner. */
const BUBBLE_LEAD_PX = 12;
/** How long a hover preview stays after the pointer left the glyph: time to move onto the bubble (1.4.13, hoverable). */
const LEAVE_GRACE_MS = 150;

type Mode = 'closed' | 'hover' | 'pinned';

/**
 * A toggletip (DESIGN-v4m R1): help that lives behind a small circled "i" right after the text it explains, instead of a line of helper
 * text on the page. A press (click, tap, Enter, Space) opens the bubble and a second press closes it; Escape, a press outside, or Tab
 * leaving the button close it too, and focus stays on the button. With a mouse, resting on the glyph 400 ms shows the same bubble as a
 * preview that the pointer can move onto, gone when the pointer leaves both (unless a click pinned it). Opening it on purpose also says
 * the words to screen readers (lib/announce.ts), since the bubble is drawn at the end of the page. The glyph is 20 px (16 with
 * `size="sm"`) in a 24 px target with a mouse and 44 px on touch; negative margins give the room back, so it never makes its line taller.
 * Never put it inside a <label> or a heading (it would join their accessible name): beside them (ui.css `.ui-tip-row`).
 */
export function InfoTip({ label, children, id, placement = 'below', size = 'md', className }: InfoTipProps): React.ReactElement {
  const tr = useT();
  const generated = React.useId();
  const buttonId = id ?? `${generated}-tip`;
  const bubbleId = `${buttonId}-bubble`;
  const buttonRef = React.useRef<HTMLButtonElement | null>(null);
  const glyphRef = React.useRef<HTMLSpanElement | null>(null);
  const [mode, setMode] = React.useState<Mode>('closed');
  const timer = React.useRef<number | undefined>(undefined);
  const open = mode !== 'closed';

  const clear = React.useCallback(() => {
    window.clearTimeout(timer.current);
    timer.current = undefined;
  }, []);
  React.useEffect(() => clear, [clear]);

  // Opened on purpose: the bubble is at the end of <body>, so its words are said where focus is (one polite announcement).
  const words = nodeText(children);
  React.useEffect(() => {
    if (mode === 'pinned') {
      announce(words);
    }
  }, [mode, words]);

  const close = React.useCallback(() => {
    clear();
    setMode('closed');
  }, [clear]);
  const leaveSoon = () => {
    clear();
    if (mode === 'hover') {
      timer.current = window.setTimeout(() => setMode((now) => (now === 'hover' ? 'closed' : now)), LEAVE_GRACE_MS);
    }
  };
  const onClose = React.useCallback(
    (reason: 'escape' | 'outside') => {
      close();
      // Escape gives the focus back to the button when it was nowhere (a press on the bubble); a hover preview leaves it where it is.
      if (reason === 'escape' && (document.activeElement === null || document.activeElement === document.body)) {
        buttonRef.current?.focus({ preventScroll: true });
      }
    },
    [close]
  );

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        id={buttonId}
        className={cx('ui-infotip', className)}
        data-size={size}
        aria-label={tr('ui.info_about', { label })}
        aria-expanded={open}
        aria-controls={open ? bubbleId : undefined}
        onClick={() => {
          clear();
          setMode((now) => (now === 'pinned' ? 'closed' : 'pinned'));
        }}
        onPointerEnter={(event) => {
          if (event.pointerType !== 'mouse') {
            return;
          }
          clear();
          if (mode === 'closed') {
            timer.current = window.setTimeout(() => setMode((now) => (now === 'closed' ? 'hover' : now)), INFO_TIP_HOVER_MS);
          }
        }}
        onPointerLeave={(event) => {
          if (event.pointerType === 'mouse') {
            leaveSoon();
          }
        }}
        onBlur={() => {
          // Tab (or a press elsewhere) leaves the button: a tip it opened goes with it.
          if (mode === 'pinned') {
            close();
          }
        }}
      >
        <span ref={glyphRef} className="ui-infotip-glyph">
          <Info size={size === 'sm' ? 16 : 20} strokeWidth={1.75} aria-hidden="true" />
        </span>
      </button>
      <Popover
        open={open}
        anchorRef={buttonRef}
        placeRef={glyphRef}
        // The bubble starts a little before the glyph and runs on to the right, over the text column it explains (its arrow at the glyph).
        align="start"
        alignOffset={-BUBBLE_LEAD_PX}
        side={placement}
        passive
        onClose={onClose}
        id={bubbleId}
        className="ui-infotip-bubble"
        data-size={size}
        onPointerEnter={clear}
        onPointerLeave={(event) => {
          if (event.pointerType === 'mouse') {
            leaveSoon();
          }
        }}
        // A press on the bubble keeps the focus on the button (no blur that would close it).
        onMouseDown={(event) => event.preventDefault()}
      >
        {children}
      </Popover>
    </>
  );
}
