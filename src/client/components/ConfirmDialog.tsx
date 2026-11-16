import React from 'react';
import type { ThemeTokens } from '../theme';
import { useT } from '../lib/i18n';
import { Button, Dialog } from '../ui';

interface ConfirmDialogProps {
  isOpen: boolean;
  /** Not used any more (the dialog takes its colours from the theme variables); callers keep passing it. */
  t: ThemeTokens;
  title: string;
  body: string;
  /**
   * What the question is about, named under the sentence (J4-21: the subject of the message that is deleted for good), so the person does
   * not have to guess it from the dimmed row behind the scrim. Shown as it is, on a quiet line of its own (cut with an ellipsis).
   */
  detail?: string;
  confirmLabel: string;
  /** The safe choice; default Cancel ("Keep editing" when compose asks before closing). */
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Asks before something that cannot be undone. Cancel has focus first (the safe choice); Escape and a press on the scrim cancel. It is a
 * ui/Dialog (an alertdialog), which traps Tab and gives focus back to the control that was used to open it.
 */
export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  isOpen,
  title,
  body,
  detail,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel
}) => {
  const tr = useT();
  const cancelRef = React.useRef<HTMLButtonElement | null>(null);
  return (
    <Dialog
      open={isOpen}
      onClose={onCancel}
      title={title}
      description={body}
      size="sm"
      role="alertdialog"
      closeButton={false}
      initialFocusRef={cancelRef}
      footer={
        <>
          <Button ref={cancelRef} onClick={onCancel}>
            {cancelLabel ?? tr('common.cancel')}
          </Button>
          <Button variant="danger" onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {detail === undefined || detail === '' ? null : <p className="rd-confirm-detail">{detail}</p>}
    </Dialog>
  );
};
