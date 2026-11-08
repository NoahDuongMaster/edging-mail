import type React from 'react';
import type { ThemeTokens } from '../theme';
import { describeNotice, formatWhen } from '../lib/activity';
import { useT } from '../lib/i18n';
import { noticeKeyId, pendingFor, useCancelLockedDelete, useLockedMail } from '../lib/lockedMail';
import type { LockedMail } from '../lib/lockedMail';
import { bannerNotices, useCancelTwoFactorReset, useDismissNotice, useNotices } from '../lib/notices';
import type { AccountNotice } from '../lib/activity';
import { Banner, Button } from '../ui';
import './mailbox.css';

interface NoticesBannerProps {
  t: ThemeTokens;
  /** Opens Settings on the Account tab, where every notice is listed. */
  onOpenSettings: () => void;
}

const NoticeRow: React.FC<{ notice: AccountNotice; lockedMail: readonly LockedMail[] | undefined }> = ({ notice, lockedMail }) => {
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
  const hasActions = resetPending || lockedPending || dismissible;
  return (
    <li>
      <Banner
        tone="warning"
        action={
          hasActions ? (
            <div className="mb-actions">
              {resetPending ? (
                <Button size="sm" disabled={cancel.isPending} onClick={() => cancel.mutate()}>
                  {tr('notice.cancel_reset')}
                </Button>
              ) : null}
              {lockedPending ? (
                <Button size="sm" data-locked-cancel disabled={cancelLocked.isPending} onClick={() => cancelLocked.mutate(pendingKey)}>
                  {tr('locked.cancel')}
                </Button>
              ) : null}
              {dismissible ? (
                <Button size="sm" disabled={dismiss.isPending} onClick={() => dismiss.mutate(notice.id)}>
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
        {dismissible || notice.dismissibleAfter === undefined ? null : (
          <p className="mb-note">{tr('notice.dismiss_later', { date: formatWhen(notice.dismissibleAfter) })}</p>
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
 * another admin. A notice that asks the person to act (a pending two-factor reset, a pending deletion) always comes first. Calm on purpose: one
 * warning banner per notice, no counters.
 */
export const NoticesBanner: React.FC<NoticesBannerProps> = ({ onOpenSettings }) => {
  const tr = useT();
  const query = useNotices();
  const lockedMail = useLockedMail().data;
  const { shown, rest } = bannerNotices(query.data ?? []);
  if (shown.length === 0) {
    return null;
  }
  return (
    <section aria-label={tr('notice.region')} className="mb-strip">
      <ul role="list" className="mb-strip-list">
        {shown.map((notice) => (
          <NoticeRow key={notice.id} notice={notice} lockedMail={lockedMail} />
        ))}
      </ul>
      {rest > 0 ? (
        <p className="mb-strip-more">
          <Button variant="ghost" size="sm" onClick={onOpenSettings}>
            {tr('notice.more')}
          </Button>
        </p>
      ) : null}
    </section>
  );
};
