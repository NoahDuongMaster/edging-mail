import React from 'react';
import { Loader2 } from 'lucide-react';
import type { ThemeTokens } from '../../theme';
import { fmt, tDyn, useT, type TFunction } from '../../lib/i18n';
import { useAdminAudit } from '../../lib/admin/audit';
import { adminErrorText, detailLine } from '../../lib/admin/types';
import { Loading } from './TempPasswordDialog';
import { adminStyles } from './adminUi';

/** The sentence for an audit action code (`audit.action.<code>`); a code this client does not know is named as it is, never hidden or shown as a bare key. */
const actionLabel = (action: string, tr: TFunction): string => tDyn(`audit.action.${action}`) ?? tr('audit.action_unknown', { action });

export const AuditPanel: React.FC<{ t: ThemeTokens }> = ({ t }) => {
  const tr = useT();
  const s = adminStyles(t);
  const query = useAdminAudit();
  const entries = React.useMemo(() => query.data?.pages.flatMap((page) => page.entries) ?? [], [query.data]);

  if (query.isError && query.data === undefined) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <p role="alert" style={{ ...s.muted, color: s.danger }}>
          {adminErrorText(query.error)}
        </p>
        <button
          type="button"
          onClick={() => {
            void query.refetch();
          }}
          style={s.button}
        >
          {tr('common.retry')}
        </button>
      </div>
    );
  }
  if (query.data === undefined) {
    return <Loading t={t} label={tr('audit.loading')} />;
  }
  if (entries.length === 0) {
    return <p style={s.muted}>{tr('audit.empty')}</p>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <p style={s.muted}>{tr('audit.intro')}</p>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column' }}>
        {entries.map((entry, index) => {
          const detail = detailLine(entry.detail);
          return (
            <li
              key={entry.id}
              style={{ padding: '10px 0', borderTop: index === 0 ? 0 : `1px solid ${t.divider}`, fontSize: 13.5, lineHeight: '20px' }}
            >
              <div style={{ display: 'flex', gap: '2px 12px', justifyContent: 'space-between', flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 600 }}>{actionLabel(entry.action, tr)}</span>
                <time dateTime={new Date(entry.at).toISOString()} style={{ color: t.text2 }}>
                  {fmt.dateTime(entry.at)}
                </time>
              </div>
              <div style={{ color: t.text2, overflowWrap: 'anywhere' }}>
                {entry.target === '' ? entry.actor_email : tr('audit.actor_to_target', { actor: entry.actor_email, target: entry.target })}
              </div>
              {detail === '' ? null : <div style={{ color: t.text2, overflowWrap: 'anywhere', fontSize: 12.5 }}>{detail}</div>}
            </li>
          );
        })}
      </ul>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        {query.hasNextPage ? (
          <button
            type="button"
            disabled={query.isFetchingNextPage}
            onClick={() => {
              void query.fetchNextPage();
            }}
            style={{ ...s.button, cursor: query.isFetchingNextPage ? 'progress' : 'pointer' }}
          >
            {query.isFetchingNextPage ? <Loader2 size={16} className="nm-spin" aria-hidden="true" /> : null}
            {tr('list.load_more')}
          </button>
        ) : (
          <span style={s.muted}>{tr('audit.end')}</span>
        )}
        {query.isError ? (
          <span role="alert" style={{ ...s.muted, color: s.danger }}>
            {adminErrorText(query.error)}
          </span>
        ) : null}
      </div>
    </div>
  );
};
