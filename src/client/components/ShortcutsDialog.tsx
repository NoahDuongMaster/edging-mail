import type React from 'react';
import { useT } from '../lib/i18n';
import { Button, Dialog } from '../ui';
import { ShortcutList } from './ShortcutList';

interface ShortcutsDialogProps {
  open: boolean;
  onClose: () => void;
  /** Opens Settings at Keyboard, where single-key shortcuts can be turned off (the caller closes this dialog). */
  onOpenSettings: () => void;
}

/**
 * The keyboard shortcuts of the mailbox, opened with `?` (single keys on) or from Settings > Keyboard: every key in four groups (move
 * around, act on a message, select several, compose) in two columns, so the list fits a laptop screen without scrolling, drawn by
 * ShortcutList from the one source Settings uses too, and a way to Settings > Keyboard, where single keys can be turned off (WCAG 2.1.4).
 */
export const ShortcutsDialog: React.FC<ShortcutsDialogProps> = ({ open, onClose, onOpenSettings }) => {
  const tr = useT();
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={tr('prefs.shortcuts_table')}
      description={tr('shortcuts.lead')}
      size="lg"
      className="mb-keys-dialog"
      footer={
        <>
          <Button variant="ghost" onClick={onOpenSettings}>
            {tr('shortcuts.settings')}
          </Button>
          <Button onClick={onClose}>{tr('common.close')}</Button>
        </>
      }
    >
      <ShortcutList headingLevel={3} idPrefix="keys-dialog" columns />
    </Dialog>
  );
};
