import React from 'react';
import type { ThemeTokens } from '../../theme';
import type { AdminUser } from '../../lib/admin/types';
import { useDeleteUser } from '../../lib/admin/users';
import { tRich, useT } from '../../lib/i18n';
import { Button, TextField } from '../../ui';
import { ErrorText, ModalFrame } from './adminUi';
import { useAdminAction } from './useAdminAction';

interface DeleteUserDialogProps {
  t: ThemeTokens;
  user: AdminUser;
  onClose: () => void;
  onDeleted: () => void;
}

/** Deleting an account takes its mail with it, so the admin types the exact address first. */
export const DeleteUserDialog: React.FC<DeleteUserDialogProps> = ({ t, user, onClose, onDeleted }) => {
  const tr = useT();
  const remove = useDeleteUser();
  const action = useAdminAction();
  const [typed, setTyped] = React.useState('');
  const field = React.useRef<HTMLInputElement | null>(null);
  const matches = typed.trim() === user.email;

  // The frame puts focus on its first control, which is the Close button in its title bar and comes before the form; the field for the address is where it belongs.
  // The frame's own effect has run by now (a child's effect runs first), so this one wins.
  React.useEffect(() => {
    field.current?.focus({ preventScroll: true });
  }, []);

  const submit = async (event: React.SyntheticEvent) => {
    event.preventDefault();
    if (!matches || action.busy) {
      return;
    }
    const done = await action.run(() => remove.mutateAsync({ id: user.id, confirm: user.email }));
    if (done) {
      onDeleted();
    }
  };

  return (
    <ModalFrame t={t} title={tr('users.delete_title')} onClose={onClose} locked={action.busy} alert>
      <form
        noValidate
        onSubmit={(event) => {
          void submit(event);
        }}
        className="ad-form"
      >
        <p className="ad-text">{tRich('users.delete_body', { address: <strong className="ad-strong ad-wrap">{user.email}</strong> })}</p>
        <div className="ad-field-group">
          <p className="ad-muted">{tr('security.admin_delete_lost_keys')}</p>
          <p className="ad-muted">{tr('users.delete_key_note')}</p>
        </div>
        <TextField
          ref={field}
          id="delete-user-confirm"
          label={tr('users.delete_confirm_label')}
          data-autofocus
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          autoComplete="off"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          placeholder={user.email}
        />
        {action.error === null ? null : <ErrorText>{action.error}</ErrorText>}
        <div className="ad-dialog-foot">
          <Button onClick={onClose} disabled={action.busy}>
            {tr('common.cancel')}
          </Button>
          <Button type="submit" disabled={!matches || action.busy} variant="danger" loading={action.busy}>
            {action.busy ? tr('users.deleting') : tr('admin.delete_account')}
          </Button>
        </div>
      </form>
    </ModalFrame>
  );
};
