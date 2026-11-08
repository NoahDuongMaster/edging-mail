import type React from 'react';
import { ShieldAlert } from 'lucide-react';
import type { ThemeTokens } from '../theme';
import { describeNotice, formatWhen } from '../lib/activity';
import { useT } from '../lib/i18n';
import { noticeKeyId, pendingFor, useCancelLockedDelete, useLockedMail } from '../lib/lockedMail';
import type { LockedMail } from '../lib/lockedMail';
import { bannerNotices, useCancelTwoFactorReset, useDismissNotice, useNotices } from '../lib/notices';
import type { AccountNotice } from '../lib/activity';

interface NoticesBannerProps {
  t: ThemeTokens;
  /** Opens Settings on the Account tab, where every notice is listed. */
  onOpenSettings: () => void;
}

const NoticeRow: React.FC<{ t: ThemeTokens; notice: AccountNotice; lockedMail: readonly LockedMail[] | undefined }> = ({
  t,
  notice,
  lockedMail
}) => {
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
  const button: React.CSSProperties = {
    height: 28,
    padding: '0 10px',
    borderRadius: 8,
    border: `1px solid ${t.border}`,
    background: 'transparent',
    color: t.text,
    fontSize: 12,
    cursor: 'pointer'
  };
  return (
    <li style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '8px 12px', fontSize: 13, lineHeight: '19px' }}>
      <ShieldAlert size={16} aria-hidden="true" style={{ flex: 'none', marginTop: 2, color: t.dark ? '#FBBF24' : '#B45309' }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ margin: 0 }}>{describeNotice(notice)}</p>
        {over ? (
          <p data-locked-notice-state="over" style={{ margin: '2px 0 0', fontSize: 12, color: t.text2 }}>
            {tr('locked.not_pending')}
          </p>
        ) : null}
        {dismissible || notice.dismissibleAfter === undefined ? null : (
          <p style={{ margin: '2px 0 0', fontSize: 12, color: t.text3 }}>
            {tr('notice.dismiss_later', { date: formatWhen(notice.dismissibleAfter) })}
          </p>
        )}
        {failed ? (
          <p role="alert" style={{ margin: '2px 0 0', fontSize: 12, color: t.dark ? '#F87171' : '#B91C1C' }}>
            {(cancelLocked.error ?? cancel.error ?? dismiss.error)?.message}
          </p>
        ) : null}
        {notice.kind === '2fa_reset_pending' ? (
          <div style={{ marginTop: 6 }}>
            <button type="button" className="nm-tap-h" disabled={cancel.isPending} onClick={() => cancel.mutate()} style={button}>
              {tr('notice.cancel_reset')}
            </button>
          </div>
        ) : null}
        {pending !== undefined && pendingKey !== null ? (
          <div style={{ marginTop: 6 }}>
            <button
              type="button"
              className="nm-tap-h"
              data-locked-cancel
              disabled={cancelLocked.isPending}
              onClick={() => cancelLocked.mutate(pendingKey)}
              style={button}
            >
              {tr('locked.cancel')}
            </button>
          </div>
        ) : null}
      </div>
      {dismissible ? (
        <button type="button" className="nm-tap-h" disabled={dismiss.isPending} onClick={() => dismiss.mutate(notice.id)} style={button}>
          {tr('notice.dismiss')}
        </button>
      ) : null}
    </li>
  );
};

/**
 * Account notices above the mailbox: a reset of two-factor sign-in, a use of the recovery key, a deletion of locked mail, an admin's alert about
 * another admin. A notice that asks the person to act (a pending two-factor reset, a pending deletion) always comes first. Calm on purpose: one
 * plain card, no counters.
 */
export const NoticesBanner: React.FC<NoticesBannerProps> = ({ t, onOpenSettings }) => {
  const tr = useT();
  const query = useNotices();
  const lockedMail = useLockedMail().data;
  const { shown, rest } = bannerNotices(query.data ?? []);
  if (shown.length === 0) {
    return null;
  }
  return (
    <section
      aria-label={tr('notice.region')}
      style={{ flex: 'none', borderBottom: `1px solid ${t.border}`, background: t.dark ? '#2A2110' : '#FFFBEB', color: t.text }}
    >
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {shown.map((notice) => (
          <NoticeRow key={notice.id} t={t} notice={notice} lockedMail={lockedMail} />
        ))}
      </ul>
      {rest > 0 ? (
        <p style={{ margin: 0, padding: '0 12px 8px 38px', fontSize: 12 }}>
          <button
            type="button"
            className="nm-tap-h"
            onClick={onOpenSettings}
            style={{
              border: 0,
              padding: 0,
              background: 'none',
              color: t.accent,
              textDecoration: 'underline',
              cursor: 'pointer',
              font: 'inherit'
            }}
          >
            {tr('notice.more')}
          </button>
        </p>
      ) : null}
    </section>
  );
};
