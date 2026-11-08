import React from 'react';
import { Plus, Search } from 'lucide-react';
import type { ThemeTokens } from '../../theme';
import { useSession } from '../../lib/auth';
import { fmt, useT } from '../../lib/i18n';
import { adminErrorText } from '../../lib/admin/types';
import type { AdminUser } from '../../lib/admin/types';
import { useAdminUsers } from '../../lib/admin/users';
import { useDebounced } from '../../lib/useDebounced';
import { Badge, Button, EmptyState, Table, TableSkeleton, TextField } from '../../ui';
import { CreateUserDialog } from './CreateUserDialog';
import { DeleteUserDialog } from './DeleteUserDialog';
import { TempPasswordDialog } from './TempPasswordDialog';
import { UserDialog } from './UserDialog';
import { ErrorText, LoadError } from './adminUi';

type Dialog =
  | { kind: 'create' }
  // `back`: opened again by Cancel in Delete account, so the person dialog puts the focus back on its Delete account button.
  | { kind: 'manage'; id: string; back?: boolean }
  | { kind: 'delete'; id: string }
  | { kind: 'password'; address: string; password: string; reissued: boolean }
  | null;

/** One person: the name is the button that opens their dialog (every action on an account is asked and confirmed there). */
const UserRow: React.FC<{ user: AdminUser; onOpen: () => void }> = ({ user, onOpen }) => {
  const tr = useT();
  const title = user.display_name === '' ? user.email : user.display_name;
  const when = user.last_login_at === null ? null : fmt.dateTime(user.last_login_at);
  return (
    <tr>
      <td className="ad-cell-person ad-wrap">
        <button type="button" className="ad-person" onClick={onOpen}>
          <span className="ad-cell-title">{title}</span>
          {user.display_name === '' ? null : <span className="ad-sub">{user.email}</span>}
          {user.aliases.length === 0 ? null : <span className="ad-sub">{tr('users.extra_addresses', { count: user.aliases.length })}</span>}
        </button>
      </td>
      <td className="ad-shrink">
        <Badge tone={user.role === 'admin' ? 'accent' : 'neutral'}>{user.role === 'admin' ? tr('term.admin') : tr('term.member')}</Badge>
      </td>
      <td className="ad-shrink">
        <Badge tone={user.status === 'disabled' ? 'warning' : 'success'}>
          {user.status === 'disabled' ? tr('users.status_disabled') : tr('users.status_active')}
        </Badge>
      </td>
      <td className="ad-cell-when ad-shrink ad-end ad-quiet">
        {when === null ? (
          tr('users.not_signed_in_yet')
        ) : (
          <>
            <span className="ad-wide">{when}</span>
            <span className="ad-narrow">{tr('users.last_sign_in', { when })}</span>
          </>
        )}
      </td>
    </tr>
  );
};

interface UsersPanelProps {
  t: ThemeTokens;
  onGoToDomains: () => void;
}

export const UsersPanel: React.FC<UsersPanelProps> = ({ t, onGoToDomains }) => {
  const tr = useT();
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
      <LoadError
        error={query.error}
        onRetry={() => {
          void query.refetch();
        }}
      />
    );
  } else if (query.data === undefined) {
    body = <TableSkeleton label={tr('users.loading')} />;
  } else if (users.length === 0) {
    body = <EmptyState title={debounced.trim() === '' ? tr('users.empty') : tr('users.no_match', { query: debounced.trim() })} />;
  } else {
    body = (
      <>
        <Table label={tr('admin.tab_people')} dense className="ad-table">
          <thead>
            <tr>
              <th scope="col">{tr('term.account')}</th>
              <th scope="col">{tr('users.role')}</th>
              <th scope="col">{tr('users.col_status')}</th>
              <th scope="col" className="ad-end">
                {tr('users.col_last_sign_in')}
              </th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <UserRow key={user.id} user={user} onOpen={() => setDialog({ kind: 'manage', id: user.id })} />
            ))}
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
          ) : null}
          <span role="status">{tr('users.showing', { shown: fmt.number(users.length), total: fmt.number(total) })}</span>
          {query.isError ? <ErrorText>{adminErrorText(query.error)}</ErrorText> : null}
        </div>
      </>
    );
  }

  return (
    <div className="ad-pane" data-fill="true">
      <div className="ad-toolbar">
        <TextField
          type="search"
          label={tr('users.search_label')}
          hideLabel
          placeholder={tr('users.search_placeholder')}
          leading={<Search size={16} aria-hidden="true" />}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Button variant="primary" leadingIcon={<Plus size={16} aria-hidden="true" />} onClick={() => setDialog({ kind: 'create' })}>
          {tr('users.new_account')}
        </Button>
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
          focusDelete={dialog?.kind === 'manage' && dialog.back === true}
        />
      )}
      {deleting === undefined ? null : (
        <DeleteUserDialog
          t={t}
          user={deleting}
          onClose={() => setDialog({ kind: 'manage', id: deleting.id, back: true })}
          onDeleted={close}
        />
      )}
    </div>
  );
};
