import React from 'react';
import { Badge, Button, Dialog, Popover, type BadgeTone } from '../../ui';

/** One action the explanation offers (an unverified sender: "Move to Spam"). */
export interface TrustAction {
  label: string;
  icon?: React.ReactNode;
  run: () => void;
}

interface TrustChipProps {
  tone: BadgeTone;
  /** The small icon before the words (12 px, aria-hidden). */
  icon: React.ReactNode;
  /** What the chip says ("End-to-end encrypted", "Unverified sender"). */
  label: string;
  /** The heading of the explanation. */
  heading: string;
  /** The explanation: what the chip means and what it does not promise. */
  note: string;
  /** The id of the explanation (the chip's aria-controls while it is open). */
  noteId: string;
  /** The hook of the chip for tests and styles (`data-e2e-badge`, `data-unverified-sender`). */
  data: Record<`data-${string}`, string>;
  /** A quiet action under the explanation (J4-34: "Move to Spam" for an unverified sender); it closes the explanation. */
  action?: TrustAction;
  /** A phone: the explanation opens as the same bottom sheet as Snooze and Add label (J3-26), not as a popover beside the chip. */
  sheet?: boolean;
}

/**
 * A trust chip of the reader's header (sealed end to end, sender not verified): quiet words with their icon that are a button (neutral for the
 * sealed one, the caution tone for an unverified sender; no chevron, the recipients keep the sender block's one disclosure), and the
 * explanation it opens in a popover (a small non-modal dialog). A keyboard or pointer open moves focus to the explanation, so a screen reader reads it;
 * Escape closes it and gives focus back to the chip, Tab closes it and goes on from the chip, a press outside closes it. It is drawn in the
 * body, so the pane never clips it. Never a colour alone: the chip has its words and its icon. On a phone (`sheet`) the explanation is a
 * bottom sheet (ui Dialog: full width, grab handle, scrim; focus on the sheet itself, Escape and the scrim close it, focus returns to the
 * chip). An `action` sits under the words in both.
 */
export const TrustChip: React.FC<TrustChipProps> = ({ tone, icon, label, heading, note, noteId, data, action, sheet = false }) => {
  const [open, setOpen] = React.useState(false);
  const buttonRef = React.useRef<HTMLButtonElement | null>(null);
  const bodyRef = React.useRef<HTMLDivElement | null>(null);
  const panelRef = React.useRef<HTMLDivElement | null>(null);
  const close = React.useCallback(() => setOpen(false), []);

  React.useEffect(() => {
    if (!open || sheet) {
      return;
    }
    bodyRef.current?.focus({ preventScroll: true });
    // The mail frame is sandboxed: a press inside it never reaches this document, only the window losing focus to it does.
    const onWindowBlur = () => {
      if (document.activeElement instanceof HTMLIFrameElement) {
        setOpen(false);
      }
    };
    window.addEventListener('blur', onWindowBlur);
    return () => window.removeEventListener('blur', onWindowBlur);
  }, [open, sheet]);

  const actionButton =
    action === undefined ? null : (
      <Button
        size="sm"
        variant="secondary"
        className="rd-trust-action"
        leadingIcon={action.icon}
        onClick={() => {
          setOpen(false);
          action.run();
        }}
      >
        {action.label}
      </Button>
    );

  return (
    <span className="rd-trust" {...data}>
      <button
        ref={buttonRef}
        type="button"
        className="nm-tap-h rd-badge-btn"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open && !sheet ? noteId : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        {/* Quiet words with their icon (v3 R3): no chevron of its own; aria-haspopup says it opens, the pointer gets a soft fill. */}
        <Badge tone={tone} className="rd-badge">
          {icon}
          {label}
        </Badge>
      </button>
      {sheet ? (
        <Dialog
          ref={panelRef}
          open={open}
          onClose={close}
          title={heading}
          size="sm"
          className="rd-sheet rd-trust-sheet"
          // Opened by a touch: the sheet itself takes focus, so no control shows a ring or a fill nobody asked for (J3-25).
          initialFocusRef={panelRef}
          returnFocusRef={buttonRef}
        >
          <div className="rd-trust-sheet-body">
            <p className="rd-trust-note">{note}</p>
            {actionButton}
          </div>
        </Dialog>
      ) : (
        <Popover
          open={open}
          anchorRef={buttonRef}
          onClose={(reason) => {
            setOpen(false);
            if (reason === 'escape') {
              buttonRef.current?.focus();
            }
          }}
          id={noteId}
          role="dialog"
          aria-labelledby={`${noteId}-title`}
          className="rd-trust-pop"
          onKeyDown={(event) => {
            // The explanation lives at the end of the body: Tab leaves it and goes on from the chip (Tab on to its action first).
            if (event.key === 'Tab' && (action === undefined || event.shiftKey || event.target instanceof HTMLButtonElement)) {
              setOpen(false);
              buttonRef.current?.focus();
            }
          }}
        >
          <div ref={bodyRef} tabIndex={-1} className="rd-trust-body">
            <p id={`${noteId}-title`} className="rd-trust-title" data-tone={tone}>
              {icon}
              <span>{heading}</span>
            </p>
            <p className="rd-trust-note">{note}</p>
            {actionButton}
          </div>
        </Popover>
      )}
    </span>
  );
};
