import React from 'react';
import { Loader2 } from 'lucide-react';
import type { ThemeTokens } from '../../theme';
import { deriveAccountAuth } from '../../lib/credentials';
import { TEMP_PASSWORD_HOURS, type AdminUser, type Role } from '../../lib/admin/types';
import { adminClaim } from '../../lib/admin/claims';
import { usePatchUser, useReissueTempPassword, useResetTwoFactor, type TwoFactorResetResult } from '../../lib/admin/users';
import { formatWhen } from '../../lib/activity';
import { useT } from '../../lib/i18n';
import { generateTempPassword } from '../../lib/password/random';
import { AliasEditor } from './AliasEditor';
import { Badge, ModalFrame, adminStyles } from './adminUi';
import { useAdminAction } from './useAdminAction';

interface UserDialogProps {
  t: ThemeTokens;
  user: AdminUser;
  /** The signed-in admin: they cannot disable, delete or reset the two-factor sign-in of their own account here. */
  selfId: string | undefined;
  onClose: () => void;
  onDelete: () => void;
  /** A new temporary password was issued: it is handed over here, once, and kept nowhere else. */
  onReissued: (account: { address: string; password: string }) => void;
}

type Confirming = 'disable' | 'reset2fa' | 'promote' | 'demote' | 'reissue' | null;

/**
 * Where the button that asked for each confirmation stands in the row of actions (the first button of the row is the role button, then the status one, the two-factor
 * one and the temporary password one; Delete account comes last and opens a dialog of its own). Focus goes back to that place, because after a role or a status change
 * the button there has another name. The order of the buttons in the row is pinned by a test.
 */
const BUTTON_PLACE: Record<Exclude<Confirming, null>, number> = { promote: 0, demote: 0, disable: 1, reset2fa: 2, reissue: 3 };

export const UserDialog: React.FC<UserDialogProps> = ({ t, user, selfId, onClose, onDelete, onReissued }) => {
  const tr = useT();
  const s = adminStyles(t);
  const patch = usePatchUser();
  const reset = useResetTwoFactor();
  const reissue = useReissueTempPassword();
  const action = useAdminAction();
  const [name, setName] = React.useState(user.display_name);
  const [confirming, setConfirming] = React.useState<Confirming>(null);
  const actionsRef = React.useRef<HTMLElement | null>(null);
  // The confirmation on screen at the last render. When one appears, the button that asked for it is gone, so focus goes to the first control marked for it, the
  // Cancel button (the least destructive control: a held Enter must not land on the action); when it goes away (Cancel, Escape, or done) focus goes back to the
  // button that asked, never to the page.
  const shownRef = React.useRef<Confirming>(null);
  React.useEffect(() => {
    const before = shownRef.current;
    shownRef.current = confirming;
    let target: HTMLElement | null | undefined;
    if (confirming !== null) {
      target = actionsRef.current?.querySelector<HTMLElement>('[data-autofocus]');
    } else if (before !== null) {
      target = actionsRef.current?.querySelectorAll<HTMLElement>('button').item(BUTTON_PLACE[before]);
    }
    target?.focus({ preventScroll: true });
  }, [confirming]);
  // When an admin's two-factor reset was scheduled for (it is not done yet): said under the buttons, not as a success.
  const [scheduledDue, setScheduledDue] = React.useState<number | null>(null);
  const isSelf = user.id === selfId;
  const nameChanged = name.trim() !== user.display_name;
  // A new temporary password is possible only while the person has never signed in with their own password and has no keys.
  const notSignedInYet = user.never_signed_in;

  const apply = async (change: () => Promise<unknown>) => {
    const done = await action.run(change);
    if (done) {
      setConfirming(null);
    }
  };

  const saveName = (event: React.SyntheticEvent) => {
    event.preventDefault();
    if (nameChanged && !action.busy) {
      void apply(() => patch.mutateAsync({ id: user.id, patch: { display_name: name.trim() } }));
    }
  };

  const setRole = (role: Role) => apply(() => patch.mutateAsync({ id: user.id, patch: { role } }));

  /**
   * Keys inside a confirmation. A held Enter repeats keydown and would press the focused button again and again: it must never confirm, so a repeat is not let through.
   * Escape takes the question back first (the dialog closes on the next Escape); it does nothing while a request runs, like Cancel.
   */
  const confirmKey = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter' && event.repeat) {
      event.preventDefault();
    } else if (event.key === 'Escape' && !action.busy) {
      event.stopPropagation();
      setConfirming(null);
    }
  };

  /** `paragraphs`: each one is shown as its own paragraph; the admin claim is the word-for-word text of crypto-design.md section 15.1. */
  const confirmCopy: Record<
    Exclude<Confirming, null>,
    { paragraphs: string[]; action: string; run: () => Promise<void>; danger: boolean }
  > = {
    disable: {
      paragraphs: [tr('users.confirm_disable')],
      action: tr('admin.disable'),
      run: () => apply(() => patch.mutateAsync({ id: user.id, patch: { status: 'disabled' } })),
      danger: true
    },
    reset2fa: {
      // A member's reset is immediate; an admin's is scheduled 24 hours ahead and the admin can cancel it by signing in.
      paragraphs: [tr(user.role === 'admin' ? 'users.confirm_reset_two_factor_admin' : 'users.confirm_reset_two_factor')],
      action: tr('users.reset_two_factor'),
      run: async () => {
        const outcome: { value?: TwoFactorResetResult } = {};
        const done = await action.run(async () => {
          outcome.value = await reset.mutateAsync(user.id);
        });
        if (done) {
          setConfirming(null);
          const due = outcome.value?.applied === false ? outcome.value.due : undefined;
          setScheduledDue(due ?? null);
        }
      },
      danger: true
    },
    promote: {
      paragraphs: [adminClaim().join(' '), tr('users.confirm_promote_note')],
      action: tr('users.make_admin'),
      run: () => setRole('admin'),
      danger: false
    },
    demote: {
      paragraphs: [tr('users.confirm_demote')],
      action: tr('users.make_member'),
      run: () => setRole('member'),
      danger: false
    },
    reissue: {
      paragraphs: [tr('users.confirm_reissue', { hours: TEMP_PASSWORD_HOURS })],
      action: tr('users.reissue_temp_password'),
      run: async () => {
        // A new password for every attempt: one that was never shown is never reused.
        const password = generateTempPassword();
        const done = await action.run(async () => {
          const { auth, kdf } = await deriveAccountAuth(user.email, password);
          await reissue.mutateAsync({ id: user.id, auth, kdf });
        });
        if (done) {
          setConfirming(null);
          onReissued({ address: user.email, password });
        }
      },
      danger: false
    }
  };
  const pending = confirming === null ? null : confirmCopy[confirming];

  const row: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' };
  const busyIcon = action.busy ? <Loader2 size={16} className="nm-spin" aria-hidden="true" /> : null;

  return (
    <ModalFrame t={t} title={user.email} onClose={onClose} locked={action.busy} maxWidth={560}>
      <div style={row}>
        <Badge t={t} tone="neutral">
          {user.role === 'admin' ? tr('term.admin') : tr('term.member')}
        </Badge>
        <Badge t={t} tone={user.status === 'active' ? 'good' : 'warn'}>
          {user.status === 'active' ? tr('users.status_active') : tr('users.status_disabled')}
        </Badge>
        {isSelf ? <span style={s.muted}>{tr('users.this_is_you')}</span> : null}
        {notSignedInYet ? (
          <Badge t={t} tone="warn">
            {tr('users.not_signed_in_yet')}
          </Badge>
        ) : null}
      </div>

      <form onSubmit={saveName} style={{ ...s.card, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <label htmlFor="user-name" style={s.label}>
          {tr('term.display_name')}
        </label>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input
            id="user-name"
            maxLength={100}
            autoComplete="off"
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={{ ...s.input, flex: '1 1 200px', minWidth: 0, width: 'auto' }}
          />
          <button
            type="submit"
            disabled={!nameChanged || action.busy}
            style={{
              ...s.button,
              height: 44,
              opacity: nameChanged ? 1 : 0.5,
              cursor: action.busy ? 'progress' : nameChanged ? 'pointer' : 'not-allowed'
            }}
          >
            {tr('users.save_name')}
          </button>
        </div>
      </form>

      <AliasEditor t={t} user={user} />

      <section ref={actionsRef} aria-labelledby="user-actions" style={{ ...s.card, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <h3 id="user-actions" style={s.h3}>
          {tr('term.account')}
        </h3>
        {pending === null ? (
          <div style={row}>
            {user.role === 'member' ? (
              <button type="button" disabled={action.busy} onClick={() => setConfirming('promote')} style={s.button}>
                {tr('users.make_admin')}
              </button>
            ) : (
              <button type="button" disabled={action.busy} onClick={() => setConfirming('demote')} style={s.button}>
                {tr('users.make_member')}
              </button>
            )}
            {isSelf ? null : (
              <>
                {user.status === 'active' ? (
                  <button type="button" disabled={action.busy} onClick={() => setConfirming('disable')} style={s.button}>
                    {tr('admin.disable')}
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={action.busy}
                    onClick={() => {
                      void apply(() => patch.mutateAsync({ id: user.id, patch: { status: 'active' } }));
                    }}
                    style={s.button}
                  >
                    {busyIcon}
                    {tr('admin.enable')}
                  </button>
                )}
                <button type="button" disabled={action.busy} onClick={() => setConfirming('reset2fa')} style={s.button}>
                  {tr('users.reset_two_factor')}
                </button>
                {notSignedInYet ? (
                  <button type="button" disabled={action.busy} onClick={() => setConfirming('reissue')} style={s.button}>
                    {tr('users.reissue_temp_password')}
                  </button>
                ) : null}
                <button type="button" disabled={action.busy} onClick={onDelete} style={s.dangerButton}>
                  {tr('admin.delete_account')}
                </button>
              </>
            )}
          </div>
        ) : (
          // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- Escape is a shortcut for the Cancel button inside this group; the buttons are the controls
          <div
            role="group"
            aria-label={tr('common.confirm')}
            onKeyDown={confirmKey}
            style={{ display: 'flex', flexDirection: 'column', gap: 10 }}
          >
            {pending.paragraphs.map((paragraph) => (
              <p key={paragraph} style={{ margin: 0, fontSize: 13.5, lineHeight: '20px' }}>
                {paragraph}
              </p>
            ))}
            <div style={row}>
              <button
                type="button"
                disabled={action.busy}
                onClick={() => {
                  void pending.run();
                }}
                style={pending.danger ? s.dangerButton : s.primary}
              >
                {busyIcon}
                {pending.action}
              </button>
              <button type="button" data-autofocus disabled={action.busy} onClick={() => setConfirming(null)} style={s.button}>
                {tr('common.cancel')}
              </button>
            </div>
          </div>
        )}
        {scheduledDue === null ? null : (
          <p role="status" style={s.muted}>
            {tr('users.reset_scheduled', { due: formatWhen(scheduledDue) })}
          </p>
        )}
        {action.error === null ? null : (
          <p role="alert" style={{ ...s.muted, color: s.danger }}>
            {action.error}
          </p>
        )}
        {isSelf ? <p style={s.muted}>{tr('users.self_note')}</p> : null}
      </section>
    </ModalFrame>
  );
};
