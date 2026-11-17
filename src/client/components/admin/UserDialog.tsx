import React from 'react';
import type { ThemeTokens } from '../../theme';
import { deriveAccountAuth } from '../../lib/credentials';
import { TEMP_PASSWORD_HOURS, type AdminUser, type Role } from '../../lib/admin/types';
import { adminClaim } from '../../lib/admin/claims';
import { usePatchUser, useReissueTempPassword, useResetTwoFactor, type TwoFactorResetResult } from '../../lib/admin/users';
import { formatWhen } from '../../lib/activity';
import { useT } from '../../lib/i18n';
import { generateTempPassword } from '../../lib/password/random';
import { Button, useMediaMatch } from '../../ui';
import { AliasEditor } from './AliasEditor';
import { AccountHeading, ActionLine, NameForm, PersonSummary, personName } from './PersonHeader';
import { ErrorText, ModalFrame, MoreText, PHONE_LAYOUT } from './adminUi';
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
  /** Opened again by Cancel in Delete account: the keyboard goes back to the Delete account button, not to the close button. */
  focusDelete?: boolean;
}

type Confirming = 'disable' | 'reset2fa' | 'promote' | 'demote' | 'reissue' | null;

/**
 * Where the button that asked for each confirmation stands in the row of actions (the first button of the row is the role button, then the status one, the two-factor
 * one and the temporary password one; Delete account comes last and opens a dialog of its own). Focus goes back to that place, because after a role or a status change
 * the button there has another name. The order of the buttons in the row is pinned by a test.
 */
const BUTTON_PLACE: Record<Exclude<Confirming, null>, number> = { promote: 0, demote: 0, disable: 1, reset2fa: 2, reissue: 3 };

export const UserDialog: React.FC<UserDialogProps> = ({ t, user, selfId, onClose, onDelete, onReissued, focusDelete = false }) => {
  const tr = useT();
  const patch = usePatchUser();
  const reset = useResetTwoFactor();
  const reissue = useReissueTempPassword();
  const action = useAdminAction();
  const [confirming, setConfirming] = React.useState<Confirming>(null);
  const actionsRef = React.useRef<HTMLElement | null>(null);
  const deleteRef = React.useRef<HTMLButtonElement | null>(null);
  // Back from Delete account (its Cancel remounts this dialog): the frame gave the focus to its first control (a child's effect runs first), and
  // it goes on to the button that asked, as after a confirmation (D-6).
  React.useEffect(() => {
    if (focusDelete) {
      deleteRef.current?.focus({ preventScroll: true });
      deleteRef.current?.scrollIntoView({ block: 'nearest' });
    }
  }, [focusDelete]);
  // The confirmation on screen at the last render. When one appears, the button that asked for it is gone, so focus goes to the first control marked for it, the
  // Cancel button (the least destructive control: a held Enter must not land on the action); when it goes away (Cancel, Escape, or done) focus goes back to the
  // button that asked, never to the page.
  const shownRef = React.useRef<Confirming>(null);
  const footRef = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    const before = shownRef.current;
    shownRef.current = confirming;
    let target: HTMLElement | null | undefined;
    if (confirming !== null) {
      target = footRef.current?.querySelector<HTMLElement>('[data-autofocus]');
    } else if (before !== null) {
      target = actionsRef.current?.querySelectorAll<HTMLElement>('.ad-actions-row button').item(BUTTON_PLACE[before]);
    }
    target?.focus({ preventScroll: true });
    // On a phone sheet a confirmation can open under the fold: its question is brought into view (at once, nothing glides); its buttons
    // are the sheet's foot, always in view.
    if (confirming !== null) {
      actionsRef.current?.querySelector('.ad-confirm')?.scrollIntoView({ block: 'nearest' });
    }
  }, [confirming]);
  // When an admin's two-factor reset was scheduled for (it is not done yet): said under the buttons, not as a success.
  const [scheduledDue, setScheduledDue] = React.useState<number | null>(null);
  const isSelf = user.id === selfId;
  // On a phone a confirmation's buttons are the sheet's foot (always in view); on a desktop they stay under its question.
  const phone = useMediaMatch(PHONE_LAYOUT);
  // A new temporary password is possible only while the person has never signed in with their own password and has no keys.
  const notSignedInYet = user.never_signed_in;

  const apply = async (change: () => Promise<unknown>) => {
    const done = await action.run(change);
    if (done) {
      setConfirming(null);
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

  /** `paragraphs`: each one is shown as its own paragraph, under `title` when there is one; `details`: a long text behind a disclosure. */
  const confirmCopy: Record<
    Exclude<Confirming, null>,
    { title?: string; paragraphs: string[]; details?: string; action: string; run: () => Promise<void>; danger: boolean }
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
      // J4-36: the two things that follow for this person first; the admin claim (crypto-design.md 15.1, word for word) on request.
      title: tr('users.confirm_promote_title', { name: personName(user) }),
      paragraphs: [tr('users.make_admin_desc'), tr('users.confirm_promote_note')],
      details: adminClaim().join(' '),
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
  // A question's Cancel, then its action: on a phone the sheet's foot (DESIGN-v4m R3: it stays while the body scrolls), described by the
  // question; on a desktop under it, right-aligned. Cancel is the one that takes the focus; the group answers Escape and a held Enter.
  const foot =
    pending === null ? undefined : (
      // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- Escape is a shortcut for the Cancel button inside this group; the buttons are the controls
      <div
        ref={footRef}
        role="group"
        aria-label={tr('common.confirm')}
        onKeyDown={confirmKey}
        aria-describedby={phone ? 'user-confirm' : undefined}
        className="ad-confirm-foot"
      >
        <Button data-autofocus disabled={action.busy} onClick={() => setConfirming(null)}>
          {tr('common.cancel')}
        </Button>
        <Button
          variant={pending.danger ? 'danger' : 'primary'}
          disabled={action.busy}
          loading={action.busy}
          onClick={() => {
            void pending.run();
          }}
        >
          {pending.action}
        </Button>
      </div>
    );

  return (
    <ModalFrame t={t} title={personName(user)} onClose={onClose} locked={action.busy} maxWidth={660} footer={phone ? foot : undefined}>
      <PersonSummary user={user} isSelf={isSelf} />
      <NameForm user={user} busy={action.busy} run={apply} />

      <AliasEditor t={t} user={user} />

      <section ref={actionsRef} aria-labelledby="user-actions" className="ad-dsec">
        <AccountHeading id="user-actions" user={user} isSelf={isSelf} />
        {pending === null ? (
          <div className="ad-actions-row">
            {/* Each action's button, described by what follows from it (said in the section's InfoTip); Delete account last, apart. */}
            <ActionLine id="user-role-desc" text={tr(user.role === 'member' ? 'users.make_admin_desc' : 'users.make_member_desc')}>
              {user.role === 'member' ? (
                <Button aria-describedby="user-role-desc" disabled={action.busy} onClick={() => setConfirming('promote')}>
                  {tr('users.make_admin')}
                </Button>
              ) : (
                <Button aria-describedby="user-role-desc" disabled={action.busy} onClick={() => setConfirming('demote')}>
                  {tr('users.make_member')}
                </Button>
              )}
            </ActionLine>
            {isSelf ? null : (
              <>
                <ActionLine id="user-status-desc" text={tr(user.status === 'active' ? 'users.disable_desc' : 'users.enable_desc')}>
                  {user.status === 'active' ? (
                    <Button aria-describedby="user-status-desc" disabled={action.busy} onClick={() => setConfirming('disable')}>
                      {tr('admin.disable')}
                    </Button>
                  ) : (
                    <Button
                      aria-describedby="user-status-desc"
                      disabled={action.busy}
                      loading={action.busy}
                      onClick={() => {
                        void apply(() => patch.mutateAsync({ id: user.id, patch: { status: 'active' } }));
                      }}
                    >
                      {tr('admin.enable')}
                    </Button>
                  )}
                </ActionLine>
                {/* Kept in place (and in BUTTON_PLACE) but off when there is no two-factor sign-in to reset; then its line says why. */}
                <ActionLine
                  id="user-2fa-desc"
                  text={tr(user.two_factor ? 'users.reset_two_factor_desc' : 'users.reset_two_factor_none')}
                  shown={!user.two_factor}
                >
                  <Button
                    aria-describedby="user-2fa-desc"
                    disabled={action.busy || !user.two_factor}
                    onClick={() => setConfirming('reset2fa')}
                  >
                    {tr('users.reset_two_factor')}
                  </Button>
                </ActionLine>
                {notSignedInYet ? (
                  <ActionLine id="user-reissue-desc" text={tr('users.reissue_desc')}>
                    <Button aria-describedby="user-reissue-desc" disabled={action.busy} onClick={() => setConfirming('reissue')}>
                      {tr('users.reissue_temp_password')}
                    </Button>
                  </ActionLine>
                ) : null}
              </>
            )}
            {/* Delete account stands apart, under a hairline: its own dialog says what it deletes, before anything is. */}
            {isSelf ? null : (
              <div className="ad-action ad-danger">
                <Button ref={deleteRef} variant="danger" disabled={action.busy} onClick={onDelete}>
                  {tr('admin.delete_account')}
                </Button>
              </div>
            )}
          </div>
        ) : (
          <div id="user-confirm" className="ad-confirm">
            {pending.title === undefined ? null : <p className="ad-confirm-title">{pending.title}</p>}
            {pending.paragraphs.map((paragraph) => (
              <p key={paragraph} className="ad-text">
                {paragraph}
              </p>
            ))}
            {pending.details === undefined ? null : <MoreText label={tr('users.admin_claim_more')} text={pending.details} />}
            {phone ? null : foot}
          </div>
        )}
        {/* Said once: when the list already carries the scheduled reset, the summary at the top says it. */}
        {scheduledDue === null || user.two_factor_reset_due_at !== null ? null : (
          <p role="status" className="ad-muted">
            {tr('users.reset_scheduled', { due: formatWhen(scheduledDue) })}
          </p>
        )}
        {action.error === null ? null : <ErrorText>{action.error}</ErrorText>}
        {isSelf ? <p className="ad-muted">{tr('users.self_note')}</p> : null}
      </section>
    </ModalFrame>
  );
};
