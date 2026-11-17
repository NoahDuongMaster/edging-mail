import React from 'react';
import type { ThemeTokens } from '../theme';
import { describeNotice, formatWhen } from '../lib/activity';
import { useT } from '../lib/i18n';
import { noticeKeyId, pendingFor, useCancelLockedDelete, useLockedMail } from '../lib/lockedMail';
import type { LockedMail } from '../lib/lockedMail';
import { bannerNotices, useCancelTwoFactorReset, useDismissNotice, useNotices } from '../lib/notices';
import type { AccountNotice } from '../lib/activity';
import { Banner, Button, Disclosure, DisclosurePanel, type BannerTone } from '../ui';
import type { SettingsSection } from './SettingsModal';
import './mailbox.css';

interface NoticesBannerProps {
  t: ThemeTokens;
  /** Opens Settings at a section: Security, where every notice is listed and the password is changed. */
  onOpenSettings: (section?: SettingsSection) => void;
}

/**
 * How loud a notice is. Danger: something will happen to the account unless the person stops it (a pending reset of two-factor sign-in, a
 * pending deletion of locked mail). Warning: something happened that may not have been the person (a reset, a recovery, codes guessed).
 * Info: what another admin did, a key that was replaced as asked.
 */
function toneOf(notice: AccountNotice): BannerTone {
  switch (notice.kind) {
    case '2fa_reset_pending':
    case 'locked_delete_requested': {
      return 'danger';
    }
    case 'second_factor_locked':
    case 'password_recovered':
    case 'recovery_started':
    case 'break_glass':
    case '2fa_reset':
    case 'alert_break_glass_failures': {
      return 'warning';
    }
    default: {
      return 'info';
    }
  }
}

const RANK: Record<BannerTone, number> = { danger: 0, warning: 1, info: 2, success: 3 };

/** Notices that end with "change your password": they get the button that does it (Settings > Security). */
const CHANGE_PASSWORD = new Set(['second_factor_locked', 'password_recovered']);

const NoticeRow: React.FC<{
  notice: AccountNotice;
  lockedMail: readonly LockedMail[] | undefined;
  onOpenSettings: (section?: SettingsSection) => void;
}> = ({ notice, lockedMail, onOpenSettings }) => {
  const tr = useT();
  const dismiss = useDismissNotice();
  const cancel = useCancelTwoFactorReset();
  const cancelLocked = useCancelLockedDelete();
  const failed = dismiss.isError || cancel.isError || cancelLocked.isError;
  const dismissible = notice.dismissible === true;
  // A deletion of locked mail: its Cancel button while it is pending (its date is in the text), a plain line once it was cancelled or done (not while the list loads).
  const lockedNotice = notice.kind === 'locked_delete_requested';
  const pending = lockedMail === undefined ? undefined : pendingFor(notice, lockedMail);
  const over = lockedNotice && lockedMail !== undefined && pending === undefined;
  const pendingKey = noticeKeyId(notice);
  const resetPending = notice.kind === '2fa_reset_pending';
  const lockedPending = pending !== undefined && pendingKey !== null;
  const changePassword = CHANGE_PASSWORD.has(notice.kind);
  const hasActions = resetPending || lockedPending || dismissible || changePassword;
  return (
    <li>
      <Banner
        tone={toneOf(notice)}
        action={
          hasActions ? (
            <div className="mb-actions">
              {resetPending ? (
                <Button size="sm" variant="danger" disabled={cancel.isPending} onClick={() => cancel.mutate()}>
                  {tr('notice.cancel_reset')}
                </Button>
              ) : null}
              {lockedPending ? (
                <Button
                  size="sm"
                  variant="danger"
                  data-locked-cancel
                  disabled={cancelLocked.isPending}
                  onClick={() => cancelLocked.mutate(pendingKey)}
                >
                  {tr('locked.cancel')}
                </Button>
              ) : null}
              {changePassword ? (
                <Button size="sm" onClick={() => onOpenSettings('security')}>
                  {tr('security.change_password')}
                </Button>
              ) : null}
              {dismissible ? (
                <Button size="sm" variant="ghost" disabled={dismiss.isPending} onClick={() => dismiss.mutate(notice.id)}>
                  {tr('notice.dismiss')}
                </Button>
              ) : null}
            </div>
          ) : undefined
        }
      >
        <p>{describeNotice(notice)}</p>
        {over ? (
          <p data-locked-notice-state="over" className="mb-note">
            {tr('locked.not_pending')}
          </p>
        ) : null}
        {/* Not dismissible yet (security notices stay seven days): when its Dismiss button comes, in a quiet line. */}
        {dismissible || notice.dismissibleAfter === undefined ? null : (
          <p className="mb-note" data-meta="true">
            {tr('notice.dismiss_from', { date: formatWhen(notice.dismissibleAfter) })}
          </p>
        )}
        {/* The banner is an alert region, so the failure is read out with it. */}
        {failed ? (
          <p data-tone="error" className="mb-note">
            {(cancelLocked.error ?? cancel.error ?? dismiss.error)?.message}
          </p>
        ) : null}
      </Banner>
    </li>
  );
};

/**
 * Account notices above the mailbox: a reset of two-factor sign-in, a use of the recovery key, a deletion of locked mail, an admin's alert about
 * another admin. Only the most urgent one shows (danger before warning before info; among equals a notice that asks the person to act
 * first), the others behind "N more notices" (a disclosure in place), the rest in Settings > Security. Each notice has the button that acts
 * on it.
 */
export const NoticesBanner: React.FC<NoticesBannerProps> = ({ onOpenSettings }) => {
  const tr = useT();
  const query = useNotices();
  const lockedMail = useLockedMail().data;
  const [open, setOpen] = React.useState(false);
  const panelId = React.useId();
  const { shown, rest } = bannerNotices(query.data ?? []);
  const ordered = shown.toSorted((a, b) => RANK[toneOf(a)] - RANK[toneOf(b)]);
  const first = ordered.at(0);
  if (first === undefined) {
    return null;
  }
  const others = ordered.slice(1);
  return (
    <section aria-label={tr('notice.region')} className="mb-strip">
      <ul role="list" className="mb-strip-list">
        <NoticeRow key={first.id} notice={first} lockedMail={lockedMail} onOpenSettings={onOpenSettings} />
      </ul>
      {others.length > 0 ? (
        <DisclosurePanel id={panelId} open={open} className="mb-strip-others">
          <ul role="list" className="mb-strip-list">
            {others.map((notice) => (
              <NoticeRow key={notice.id} notice={notice} lockedMail={lockedMail} onOpenSettings={onOpenSettings} />
            ))}
          </ul>
        </DisclosurePanel>
      ) : null}
      {others.length > 0 || rest > 0 ? (
        <div className="mb-strip-more">
          {others.length > 0 ? (
            <Disclosure open={open} onOpenChange={setOpen} controls={panelId} inline>
              {open ? tr('notice.fewer') : tr('notice.more_count', { count: others.length + rest })}
            </Disclosure>
          ) : null}
          {rest > 0 && (open || others.length === 0) ? (
            <Button variant="ghost" size="sm" onClick={() => onOpenSettings('security')}>
              {tr('notice.more')}
            </Button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
};
