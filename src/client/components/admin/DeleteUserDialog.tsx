import React from 'react';
import { Loader2 } from 'lucide-react';
import type { ThemeTokens } from '../../theme';
import type { AdminUser } from '../../lib/admin/types';
import { useDeleteUser } from '../../lib/admin/users';
import { tRich, useT } from '../../lib/i18n';
import { ModalFrame, adminStyles } from './adminUi';
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
  const s = adminStyles(t);
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
        style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
      >
        <p style={{ margin: 0, fontSize: 13.5, lineHeight: '20px' }}>
          {tRich('users.delete_body', { address: <strong style={{ overflowWrap: 'anywhere' }}>{user.email}</strong> })}
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <p style={s.muted}>{tr('security.admin_delete_lost_keys')}</p>
          <p style={s.muted}>{tr('users.delete_key_note')}</p>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label htmlFor="delete-user-confirm" style={s.label}>
            {tr('users.delete_confirm_label')}
          </label>
          <input
            ref={field}
            id="delete-user-confirm"
            data-autofocus
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            autoComplete="off"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={user.email}
            style={s.input}
          />
        </div>
        {action.error === null ? null : (
          <p role="alert" style={{ ...s.muted, color: s.danger }}>
            {action.error}
          </p>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" onClick={onClose} disabled={action.busy} style={s.button}>
            {tr('common.cancel')}
          </button>
          <button
            type="submit"
            disabled={!matches || action.busy}
            style={{
              ...s.dangerButton,
              cursor: action.busy ? 'progress' : matches ? 'pointer' : 'not-allowed',
              opacity: matches || action.busy ? 1 : 0.5
            }}
          >
            {action.busy ? <Loader2 size={16} className="nm-spin" aria-hidden="true" /> : null}
            {action.busy ? tr('users.deleting') : tr('admin.delete_account')}
          </button>
        </div>
      </form>
    </ModalFrame>
  );
};
