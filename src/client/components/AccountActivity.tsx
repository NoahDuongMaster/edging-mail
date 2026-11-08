import type React from 'react';
import { Loader2 } from 'lucide-react';
import type { ThemeTokens } from '../theme';
import { useT } from '../lib/i18n';
import { describeDevice, describeKind, describeNotice, formatWhen, useAccountActivity } from '../lib/activity';

interface AccountActivityProps {
  t: ThemeTokens;
}

const SHOWN = 10;

/** Settings > Account: what happened to this account that its owner should know (notices), then the recent sign-ins. */
export const AccountActivity: React.FC<AccountActivityProps> = ({ t }) => {
  const tr = useT();
  const query = useAccountActivity();
  const danger = t.dark ? '#F97066' : '#B42318';
  const card: React.CSSProperties = {
    padding: 12,
    borderRadius: 12,
    border: `1px solid ${t.border}`,
    background: t.raised,
    display: 'flex',
    flexDirection: 'column',
    gap: 8
  };
  const heading: React.CSSProperties = { margin: 0, fontWeight: 600, fontSize: 13 };
  const muted: React.CSSProperties = { color: t.text2, fontSize: 12.5, lineHeight: '19px', margin: 0 };

  let body: React.ReactNode;
  if (query.isError) {
    body = (
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <p role="alert" style={{ ...muted, color: danger }}>
          {tr('account.signins_load_failed')}
        </p>
        <button
          type="button"
          className="nm-tap-h"
          onClick={() => {
            void query.refetch();
          }}
          style={{
            height: 34,
            padding: '0 14px',
            border: `1px solid ${t.borderStrong}`,
            borderRadius: 10,
            background: t.surface,
            color: t.text,
            font: 'inherit',
            fontSize: 13,
            fontWeight: 500,
            cursor: 'pointer'
          }}
        >
          {tr('common.retry')}
        </button>
      </div>
    );
  } else if (query.data === undefined) {
    body = (
      <p role="status" style={{ ...muted, display: 'flex', alignItems: 'center', gap: 8 }}>
        <Loader2 size={14} className="nm-spin" aria-hidden="true" /> {tr('common.loading')}
      </p>
    );
  } else {
    const { activity, notices = [] } = query.data;
    body = (
      <>
        <div>
          <h4 id="account-notices" style={{ ...heading, fontWeight: 500, color: t.text2 }}>
            {tr('account.notices_title')}
          </h4>
          {notices.length === 0 ? (
            <p aria-labelledby="account-notices" style={{ ...muted, marginTop: 4 }}>
              {tr('account.notices_empty')}
            </p>
          ) : (
            <ul aria-labelledby="account-notices" style={{ listStyle: 'none', margin: '6px 0 0', padding: 0, display: 'grid', gap: 6 }}>
              {notices.map((notice) => (
                <li
                  key={notice.id}
                  style={{
                    padding: '8px 10px',
                    border: `1px solid ${danger}`,
                    borderRadius: 10,
                    background: t.surface,
                    fontSize: 13,
                    lineHeight: '19px'
                  }}
                >
                  {describeNotice(notice)}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <h4 id="account-signins" style={{ ...heading, fontWeight: 500, color: t.text2 }}>
            {tr('account.signins_title')}
          </h4>
          {activity.length === 0 ? (
            <p aria-labelledby="account-signins" style={{ ...muted, marginTop: 4 }}>
              {tr('account.signins_empty')}
            </p>
          ) : (
            <ul aria-labelledby="account-signins" style={{ listStyle: 'none', margin: '6px 0 0', padding: 0 }}>
              {activity.slice(0, SHOWN).map((entry, index) => (
                <li
                  key={`${entry.at}|${entry.kind}|${entry.ip ?? ''}|${entry.user_agent ?? ''}`}
                  style={{ padding: '8px 0', borderTop: index === 0 ? 0 : `1px solid ${t.divider}`, fontSize: 13, lineHeight: '19px' }}
                >
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 500, color: entry.ok ? t.text : danger }}>{describeKind(entry.kind, entry.ok)}</span>
                    <time dateTime={new Date(entry.at).toISOString()} style={{ color: t.text2 }}>
                      {formatWhen(entry.at)}
                    </time>
                  </div>
                  <div style={{ color: t.text2, overflowWrap: 'anywhere' }}>{describeDevice(entry.user_agent, entry.ip)}</div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </>
    );
  }

  return (
    <section aria-labelledby="settings-activity" style={card}>
      <h3 id="settings-activity" style={heading}>
        {tr('account.activity_title')}
      </h3>
      {body}
    </section>
  );
};
