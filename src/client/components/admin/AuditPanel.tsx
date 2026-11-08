import React from 'react';
import type { ThemeTokens } from '../../theme';
import { fmt, tDyn, useT, type TFunction } from '../../lib/i18n';
import { useAdminAudit } from '../../lib/admin/audit';
import { adminErrorText, detailLine } from '../../lib/admin/types';
import { Button, EmptyState, Table, TableSkeleton } from '../../ui';
import { ErrorText, LoadError } from './adminUi';

/** The sentence for an audit action code (`audit.action.<code>`); a code this client does not know is named as it is, never hidden or shown as a bare key. */
const actionLabel = (action: string, tr: TFunction): string => tDyn(`audit.action.${action}`) ?? tr('audit.action_unknown', { action });

export const AuditPanel: React.FC<{ t: ThemeTokens }> = () => {
  const tr = useT();
  const query = useAdminAudit();
  const entries = React.useMemo(() => query.data?.pages.flatMap((page) => page.entries) ?? [], [query.data]);

  if (query.isError && query.data === undefined) {
    return (
      <div className="ad-pane">
        <LoadError
          error={query.error}
          onRetry={() => {
            void query.refetch();
          }}
        />
      </div>
    );
  }
  if (query.data === undefined) {
    return (
      <div className="ad-pane">
        <TableSkeleton label={tr('audit.loading')} />
      </div>
    );
  }
  if (entries.length === 0) {
    return (
      <div className="ad-pane">
        <EmptyState title={tr('audit.empty')} />
      </div>
    );
  }

  return (
    <div className="ad-pane" data-fill="true">
      <p className="ad-muted">{tr('audit.intro')}</p>
      <Table label={tr('term.audit_log')} dense className="ad-table">
        <thead>
          <tr>
            <th scope="col">{tr('audit.col_action')}</th>
            <th scope="col">{tr('audit.col_who')}</th>
            <th scope="col" className="ad-end">
              {tr('audit.col_when')}
            </th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => {
            const detail = detailLine(entry.detail);
            return (
              <tr key={entry.id}>
                <td className="ad-cell-action ad-wrap">
                  <span className="ad-cell-title">{actionLabel(entry.action, tr)}</span>
                  {detail === '' ? null : <span className="ad-sub">{detail}</span>}
                </td>
                <td className="ad-cell-who ad-wrap ad-quiet">
                  {entry.target === ''
                    ? entry.actor_email
                    : tr('audit.actor_to_target', { actor: entry.actor_email, target: entry.target })}
                </td>
                <td className="ad-cell-at ad-end ad-nowrap ad-quiet">
                  <time dateTime={new Date(entry.at).toISOString()}>{fmt.dateTime(entry.at)}</time>
                </td>
              </tr>
            );
          })}
        </tbody>
      </Table>
      <div className="ad-foot">
        {query.hasNextPage ? (
          <Button
            size="sm"
            disabled={query.isFetchingNextPage}
            loading={query.isFetchingNextPage}
            onClick={() => {
              void query.fetchNextPage();
            }}
          >
            {tr('list.load_more')}
          </Button>
        ) : (
          <span>{tr('audit.end')}</span>
        )}
        {query.isError ? <ErrorText>{adminErrorText(query.error)}</ErrorText> : null}
      </div>
    </div>
  );
};
