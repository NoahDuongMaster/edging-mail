import React from 'react';
import { TriangleAlert } from 'lucide-react';
import type { ThemeTokens } from '../../theme';
import type { AdminUser } from '../../lib/admin/types';
import { useDeleteUser } from '../../lib/admin/users';
import { announce } from '../../lib/announce';
import { useFieldFocus } from '../../lib/fieldFocus';
import { tRich, useT } from '../../lib/i18n';
import { Button, TextField } from '../../ui';
import { ErrorText, ModalFrame, tipLines } from './adminUi';
import { useAdminAction } from './useAdminAction';

interface DeleteUserDialogProps {
  t: ThemeTokens;
  user: AdminUser;
  onClose: () => void;
  onDeleted: () => void;
}

const CONFIRM_ID = 'delete-user-confirm';
/** The form of the dialog; its Delete account is in the dialog's foot, outside it. */
const FORM_ID = 'delete-user-form';
/** The warning: what is lost. The alert dialog is described by it, so it is read on open, before the field (J1-26). */
const WARNING_ID = 'delete-user-warning';

/**
 * Deleting an account takes its mail with it, so the admin types the exact address first. Delete account can be pressed at any time (only
 * a running request turns it off): a press with another text says what to type under the field, is announced, and takes the keyboard back
 * to the field (DESIGN 6: submit buttons stay enabled and show errors on submit), as the locked-mail dialog does.
 */
export const DeleteUserDialog: React.FC<DeleteUserDialogProps> = ({ t, user, onClose, onDeleted }) => {
  const tr = useT();
  const remove = useDeleteUser();
  const action = useAdminAction();
  const [typed, setTyped] = React.useState('');
  const [submitted, setSubmitted] = React.useState(false);
  const field = React.useRef<HTMLInputElement | null>(null);
  const focusLater = useFieldFocus();
  const matches = typed.trim() === user.email;
  const mismatch = tr('users.delete_confirm_mismatch', { address: user.email });

  // The frame puts focus on its first control, which is the Close button in its title bar and comes before the form; the field for the address is where it belongs.
  // The frame's own effect has run by now (a child's effect runs first), so this one wins.
  React.useEffect(() => {
    field.current?.focus({ preventScroll: true });
  }, []);

  const submit = async (event: React.SyntheticEvent) => {
    event.preventDefault();
    if (action.busy) {
      return;
    }
    if (!matches) {
      setSubmitted(true);
      // Focus may already be in the field (Enter pressed there), so moving it says nothing: the error is also said by the live region.
      announce(mismatch, { assertive: true });
      focusLater(CONFIRM_ID);
      return;
    }
    setSubmitted(false);
    const done = await action.run(() => remove.mutateAsync({ id: user.id, confirm: user.email }));
    if (done) {
      onDeleted();
    }
  };

  return (
    <ModalFrame
      t={t}
      title={tr('users.delete_title')}
      onClose={onClose}
      locked={action.busy}
      alert
      describedBy={WARNING_ID}
      // When deleting is the answer (the Product Owner's words, as written) and what a new account at the address means, behind the title.
      info={tipLines([tr('security.admin_delete_lost_keys'), tr('users.delete_key_note')])}
      footer={
        <>
          <Button onClick={onClose} disabled={action.busy}>
            {tr('common.cancel')}
          </Button>
          <Button type="submit" disabled={action.busy} form={FORM_ID} variant="danger" loading={action.busy}>
            {action.busy ? tr('users.deleting') : tr('admin.delete_account')}
          </Button>
        </>
      }
    >
      <form
        id={FORM_ID}
        noValidate
        onSubmit={(event) => {
          void submit(event);
        }}
        className="ad-form"
      >
        {/* What is lost, on the danger tint with its icon: the one thing to read before typing the address. */}
        <p id={WARNING_ID} className="ad-text ad-warn">
          <TriangleAlert size={16} aria-hidden="true" />
          <span>{tRich('users.delete_body', { address: <strong className="ad-strong ad-wrap">{user.email}</strong> })}</span>
        </p>
        <TextField
          ref={field}
          id={CONFIRM_ID}
          label={tr('users.delete_confirm_label')}
          data-autofocus
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          autoComplete="off"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          error={submitted && !matches ? mismatch : undefined}
        />
        {action.error === null ? null : <ErrorText>{action.error}</ErrorText>}
      </form>
    </ModalFrame>
  );
};
