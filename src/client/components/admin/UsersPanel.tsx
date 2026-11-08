import React from 'react';
import { Loader2, Plus, Search } from 'lucide-react';
import type { ThemeTokens } from '../../theme';
import { useSession } from '../../lib/auth';
import { fmt, useT } from '../../lib/i18n';
import { adminErrorText } from '../../lib/admin/types';
import type { AdminUser } from '../../lib/admin/types';
import { useAdminUsers } from '../../lib/admin/users';
import { useDebounced } from '../../lib/useDebounced';
import { CreateUserDialog } from './CreateUserDialog';
import { DeleteUserDialog } from './DeleteUserDialog';
import { TempPasswordDialog, Loading } from './TempPasswordDialog';
import { UserDialog } from './UserDialog';
import { Badge, adminStyles } from './adminUi';

type Dialog =
  | { kind: 'create' }
  | { kind: 'manage'; id: string }
  | { kind: 'delete'; id: string }
  | { kind: 'password'; address: string; password: string; reissued: boolean }
  | null;

const UserRow: React.FC<{ t: ThemeTokens; user: AdminUser; onOpen: () => void }> = ({ t, user, onOpen }) => {
  const tr = useT();
  const s = adminStyles(t);
  const title = user.display_name === '' ? user.email : user.display_name;
  return (
    <li>
      <button
        type="button"
        className="nm-tap-h"
        onClick={onOpen}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: '6px 12px',
          flexWrap: 'wrap',
          padding: '10px 12px',
          border: `1px solid ${t.border}`,
          borderRadius: 12,
          background: t.surface,
          color: t.text,
          font: 'inherit',
          textAlign: 'left',
          cursor: 'pointer'
        }}
      >
        <span style={{ flex: '1 1 200px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontSize: 14, fontWeight: 600, overflowWrap: 'anywhere' }}>{title}</span>
          {user.display_name === '' ? null : <span style={{ ...s.muted, overflowWrap: 'anywhere' }}>{user.email}</span>}
          {user.aliases.length === 0 ? null : <span style={s.muted}>{tr('users.extra_addresses', { count: user.aliases.length })}</span>}
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <Badge t={t} tone="neutral">
            {user.role === 'admin' ? tr('term.admin') : tr('term.member')}
          </Badge>
          {user.status === 'disabled' ? (
            <Badge t={t} tone="warn">
              {tr('users.status_disabled')}
            </Badge>
          ) : null}
        </span>
        <span style={{ ...s.muted, flex: '1 1 100%' }}>
          {user.last_login_at === null ? tr('users.never_signed_in') : tr('users.last_sign_in', { when: fmt.dateTime(user.last_login_at) })}
        </span>
      </button>
    </li>
  );
};

interface UsersPanelProps {
  t: ThemeTokens;
  onGoToDomains: () => void;
}

export const UsersPanel: React.FC<UsersPanelProps> = ({ t, onGoToDomains }) => {
  const tr = useT();
  const s = adminStyles(t);
  const [search, setSearch] = React.useState('');
  const debounced = useDebounced(search);
  const query = useAdminUsers(debounced);
  const selfId = useSession().data?.user?.id;
  const [dialog, setDialog] = React.useState<Dialog>(null);

  const users = React.useMemo(() => query.data?.pages.flatMap((page) => page.users) ?? [], [query.data]);
  const total = query.data?.pages.at(-1)?.total ?? 0;
  const close = () => setDialog(null);
  const find = (id: string) => users.find((user) => user.id === id);
  const managed = dialog?.kind === 'manage' ? find(dialog.id) : undefined;
  const deleting = dialog?.kind === 'delete' ? find(dialog.id) : undefined;

  let body: React.ReactNode;
  if (query.isError && query.data === undefined) {
    body = (
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
  } else if (query.data === undefined) {
    body = <Loading t={t} label={tr('users.loading')} />;
  } else if (users.length === 0) {
    body = <p style={s.muted}>{debounced.trim() === '' ? tr('users.empty') : tr('users.no_match', { query: debounced.trim() })}</p>;
  } else {
    body = (
      <>
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {users.map((user) => (
            <UserRow key={user.id} t={t} user={user} onOpen={() => setDialog({ kind: 'manage', id: user.id })} />
          ))}
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
          ) : null}
          <span role="status" style={s.muted}>
            {tr('users.showing', { shown: fmt.number(users.length), total: fmt.number(total) })}
          </span>
          {query.isError ? (
            <span role="alert" style={{ ...s.muted, color: s.danger }}>
              {adminErrorText(query.error)}
            </span>
          ) : null}
        </div>
      </>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ position: 'relative', flex: '1 1 220px', minWidth: 0 }}>
          <Search size={16} aria-hidden="true" style={{ position: 'absolute', left: 12, top: 14, color: t.text3 }} />
          <input
            type="search"
            aria-label={tr('users.search_label')}
            placeholder={tr('users.search_placeholder')}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ ...s.input, paddingLeft: 36 }}
          />
        </div>
        <button type="button" onClick={() => setDialog({ kind: 'create' })} style={s.primary}>
          <Plus size={16} aria-hidden="true" />
          {tr('users.new_account')}
        </button>
      </div>
      {body}

      {dialog?.kind === 'create' ? (
        <CreateUserDialog
          t={t}
          onClose={close}
          onGoToDomains={() => {
            close();
            onGoToDomains();
          }}
          onCreated={(account) => setDialog({ kind: 'password', ...account, reissued: false })}
        />
      ) : null}
      {dialog?.kind === 'password' ? (
        <TempPasswordDialog t={t} address={dialog.address} password={dialog.password} reissued={dialog.reissued} onDone={close} />
      ) : null}
      {managed === undefined ? null : (
        <UserDialog
          t={t}
          user={managed}
          selfId={selfId}
          onClose={close}
          onDelete={() => setDialog({ kind: 'delete', id: managed.id })}
          onReissued={(account) => setDialog({ kind: 'password', ...account, reissued: true })}
        />
      )}
      {deleting === undefined ? null : (
        <DeleteUserDialog t={t} user={deleting} onClose={() => setDialog({ kind: 'manage', id: deleting.id })} onDeleted={close} />
      )}
    </div>
  );
};
