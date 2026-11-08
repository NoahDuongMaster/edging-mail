import type React from 'react';
import { useLayoutEffect, useRef, useState } from 'react';
import { CircleAlert } from 'lucide-react';
import type { ThemeTokens } from '../theme';
import { fmt, useT } from '../lib/i18n';
import { describeDevice, describeKind, describeNotice, formatWhen, useAccountActivity } from '../lib/activity';
import { Button, Disclosure, Section, Spinner } from '../ui';
import { ErrorLine } from './auth/authUi';
import './settings/settings.css';

interface AccountActivityProps {
  t: ThemeTokens;
}

/** Sign-ins shown before "Show all": the latest few, so the list does not fill the Account tab. */
const PREVIEW = 3;
const SIGNINS_LIST = 'account-signins-list';

/** Settings > Account: what happened to this account that its owner should know (notices), then the recent sign-ins, as hairline lists. */
export const AccountActivity: React.FC<AccountActivityProps> = ({ t }) => {
  const tr = useT();
  const query = useAccountActivity();
  const [showAll, setShowAll] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  const collapsing = useRef(false);

  // Show fewer takes the rows above the button away: keep the button (which keeps the focus) in view instead of leaving it far above.
  useLayoutEffect(() => {
    if (collapsing.current) {
      collapsing.current = false;
      toggle.current?.scrollIntoView({ block: 'nearest' });
    }
  }, [showAll]);

  let body: React.ReactNode;
  if (query.isError) {
    body = (
      <div className="st-inline">
        <ErrorLine t={t} id="account-activity-error" text={tr('account.signins_load_failed')} />
        <Button
          size="sm"
          onClick={() => {
            void query.refetch();
          }}
        >
          {tr('common.retry')}
        </Button>
      </div>
    );
  } else if (query.data === undefined) {
    body = (
      <p role="status" className="st-status">
        <Spinner decorative /> {tr('common.loading')}
      </p>
    );
  } else {
    const { activity, notices = [] } = query.data;
    const more = activity.length > PREVIEW;
    const shown = more && !showAll ? activity.slice(0, PREVIEW) : activity;
    body = (
      <>
        <div className="st-sub">
          <h4 id="account-notices" className="st-subtitle">
            {tr('account.notices_title')}
          </h4>
          {notices.length === 0 ? (
            <p aria-labelledby="account-notices" className="st-muted">
              {tr('account.notices_empty')}
            </p>
          ) : (
            <ul aria-labelledby="account-notices" className="st-list">
              {notices.map((notice) => (
                <li key={notice.id} className="st-notice">
                  <CircleAlert size={16} aria-hidden="true" />
                  <span>{describeNotice(notice)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="st-sub">
          <h4 id="account-signins" className="st-subtitle">
            {tr('account.signins_title')}
          </h4>
          {activity.length === 0 ? (
            <p aria-labelledby="account-signins" className="st-muted">
              {tr('account.signins_empty')}
            </p>
          ) : (
            <ul id={SIGNINS_LIST} aria-labelledby="account-signins" className="st-list">
              {shown.map((entry) => (
                <li key={`${entry.at}|${entry.kind}|${entry.ip ?? ''}|${entry.user_agent ?? ''}`} className="st-entry">
                  <div className="st-entry-top">
                    <span className="st-entry-kind" data-ok={entry.ok ? 'true' : 'false'}>
                      {describeKind(entry.kind, entry.ok)}
                    </span>
                    <time dateTime={new Date(entry.at).toISOString()} className="st-entry-time">
                      {formatWhen(entry.at)}
                    </time>
                  </div>
                  <div className="st-entry-device">{describeDevice(entry.user_agent, entry.ip)}</div>
                </li>
              ))}
            </ul>
          )}
          {more ? (
            // One button for both states (only its words change), so the focus stays on it.
            <Disclosure
              ref={toggle}
              look="button"
              size="sm"
              className="st-more"
              open={showAll}
              controls={SIGNINS_LIST}
              onOpenChange={(open) => {
                collapsing.current = !open;
                setShowAll(open);
              }}
            >
              {showAll ? tr('account.signins_show_fewer') : tr('account.signins_show_all', { count: fmt.number(activity.length) })}
            </Disclosure>
          ) : null}
        </div>
      </>
    );
  }

  return (
    <Section headingLevel={3} title={tr('account.activity_title')}>
      {body}
    </Section>
  );
};
