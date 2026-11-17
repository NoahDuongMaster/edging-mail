import React from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronRight, Plus, Search, X } from 'lucide-react';
import { avatarHue, type ThemeTokens } from '../../theme';
import { useSession } from '../../lib/auth';
import { announce } from '../../lib/announce';
import { fmt, useT } from '../../lib/i18n';
import { adminErrorText } from '../../lib/admin/types';
import type { AdminUser } from '../../lib/admin/types';
import { useAdminUsers } from '../../lib/admin/users';
import { useDebounced } from '../../lib/useDebounced';
import {
  Avatar,
  Button,
  EmptyState,
  FlightTrail,
  IconButton,
  SegmentedControl,
  Select,
  Table,
  TableSkeleton,
  TextField,
  Tooltip,
  useTooltip,
  VisuallyHidden
} from '../../ui';
import { CreateUserDialog } from './CreateUserDialog';
import { DeleteUserDialog } from './DeleteUserDialog';
import { personName } from './PersonHeader';
import { TempPasswordDialog } from './TempPasswordDialog';
import { UserDialog } from './UserDialog';
import {
  ErrorText,
  LoadError,
  PageHead,
  PersonRole,
  PersonStatus,
  PersonTwoFactor,
  personState,
  useInBar,
  type PersonState
} from './adminUi';

type Dialog =
  | { kind: 'create' }
  // `back`: opened again by Cancel in Delete account, so the person dialog puts the focus back on its Delete account button.
  | { kind: 'manage'; id: string; back?: boolean }
  | { kind: 'delete'; id: string }
  | { kind: 'password'; address: string; password: string; reissued: boolean }
  | null;

type Filter = 'all' | PersonState;

/** The two-factor filter: everyone, or only the people with (or without) two-factor sign-in. */
type TwoFactorFilter = 'any' | 'on' | 'off';
const TWO_FACTOR_FILTERS: readonly TwoFactorFilter[] = ['any', 'on', 'off'];
const twoFactorMatches = (user: AdminUser, filter: TwoFactorFilter): boolean => filter === 'any' || user.two_factor === (filter === 'on');

/** The column the list is sorted by (the name, or the last sign-in) and the direction. */
interface Sort {
  key: 'name' | 'last';
  dir: 'asc' | 'desc';
}

const nameOf = personName;

/**
 * When the person last signed in, in words ("2 hours ago"); the full date and time is in a tooltip and in the person's dialog. Screen
 * readers hear the whole sentence ("Last sign-in 2 hours ago") wherever the row is drawn: a phone's stacked row has no column header,
 * and there the words stand at the end of the name's line, as the time of a message does in the mail list.
 */
const LastSignIn: React.FC<{ at: number }> = ({ at }) => {
  const tr = useT();
  const tip = useTooltip();
  const ref = React.useRef<HTMLElement | null>(null);
  const when = fmt.relative(at);
  return (
    <>
      <time
        ref={(node) => {
          ref.current = node;
        }}
        dateTime={new Date(at).toISOString()}
        className="ad-when"
        {...tip.anchor}
      >
        <span className="ad-when-main" aria-hidden="true">
          {when}
        </span>
        <VisuallyHidden>{tr('users.last_sign_in', { when })}</VisuallyHidden>
      </time>
      <Tooltip open={tip.open} text={fmt.dateTime(at)} anchorRef={ref} {...tip.bubble} />
    </>
  );
};

/**
 * The Last sign-in cell of a person who never signed in and is still on the temporary password an admin made: when it stops working (or
 * stopped), as a short date (the full date and time are in the person's dialog).
 */
const TempExpiry: React.FC<{ at: number }> = ({ at }) => {
  const tr = useT();
  // When the row was first drawn: whether the date is still ahead does not change while the page is open.
  // eslint-disable-next-line react/hook-use-state -- a value read once (a lazy initial state), never set again
  const [now] = React.useState(() => Date.now());
  const options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  if (new Date(at).getFullYear() !== new Date(now).getFullYear()) {
    options.year = 'numeric';
  }
  const when = fmt.dateTime(at, options);
  return (
    <span className="ad-temp-expiry">
      {at > now ? tr('users.temp_password_expires', { when }) : tr('users.temp_password_expired', { when })}
    </span>
  );
};

/**
 * A column header that sorts the list (APG sortable table): a button that says what it sorts by, an arrow that shows the direction (a
 * quiet two-way arrow on the column that does not sort now), and `aria-sort` on the header of the column that does.
 */
const SortHeader: React.FC<{ label: string; sort: Sort; column: Sort['key']; onSort: () => void; className?: string }> = ({
  label,
  sort,
  column,
  onSort,
  className
}) => {
  const active = sort.key === column;
  let arrow: React.ReactNode;
  if (!active) {
    arrow = <ArrowUpDown size={12} aria-hidden="true" className="ad-sort-idle" />;
  } else if (sort.dir === 'asc') {
    arrow = <ArrowUp size={12} aria-hidden="true" />;
  } else {
    arrow = <ArrowDown size={12} aria-hidden="true" />;
  }
  let ariaSort: 'ascending' | 'descending' | undefined;
  if (active) {
    ariaSort = sort.dir === 'asc' ? 'ascending' : 'descending';
  }
  return (
    <th scope="col" className={className} aria-sort={ariaSort}>
      <button type="button" className="ad-sort" onClick={onSort}>
        {label}
        {arrow}
      </button>
    </th>
  );
};

/** A to Z by name (the address when there is none), whatever the case and the accents. */
const byName = (a: AdminUser, b: AdminUser): number => nameOf(a).localeCompare(nameOf(b), undefined, { sensitivity: 'base' });

/** By name, A to Z or Z to A; by last sign-in, newest or oldest first, with the people who never signed in last. */
function compare(sort: Sort): (a: AdminUser, b: AdminUser) => number {
  const sign = sort.dir === 'asc' ? 1 : -1;
  if (sort.key === 'name') {
    return (a, b) => sign * byName(a, b);
  }
  return (a, b) => {
    if (a.last_login_at === null || b.last_login_at === null) {
      return (a.last_login_at === null ? 1 : 0) - (b.last_login_at === null ? 1 : 0) || byName(a, b);
    }
    return sign * (a.last_login_at - b.last_login_at) || byName(a, b);
  };
}

/**
 * One person. The name is the button that opens their dialog (every action on an account is asked and confirmed there): the keyboard and
 * screen reader route. A click anywhere else on the row does the same for the mouse, and the quiet Manage with its chevron at the row's end
 * says the row opens (it is a picture of that, not a second control: the name is the one).
 */
const UserRow: React.FC<{ user: AdminUser; onOpen: () => void }> = ({ user, onOpen }) => {
  const tr = useT();
  const title = nameOf(user);
  const openFromRow = (event: React.MouseEvent) => {
    if ((event.target as HTMLElement).closest('button') === null) {
      onOpen();
    }
  };
  return (
    // A pointer shortcut: the name button in the first cell is the control for the keyboard and screen readers.
    <tr className="ad-link-row" data-state={personState(user)} onClick={openFromRow}>
      <td className="ad-cell-person ad-wrap">
        <div className="ad-who">
          {/* Each person's own tint; a disabled account keeps the quiet neutral tile. */}
          <Avatar name={title} size="md" hue={user.status === 'disabled' ? undefined : avatarHue(user.email)} />
          <button type="button" className="ad-person" onClick={onOpen}>
            <span className="ad-cell-title">{title}</span>
            {user.display_name === '' && user.aliases.length === 0 ? null : (
              <span className="ad-sub">
                {user.display_name === '' ? null : <span>{user.email}</span>}
                {user.aliases.length === 0 ? null : (
                  <span className="ad-sub-extra">
                    <span className="ad-extra-long">{tr('users.extra_addresses', { count: user.aliases.length })}</span>
                    <span className="ad-extra-short" aria-hidden="true">
                      {tr('users.extra_addresses_short', { count: fmt.number(user.aliases.length) })}
                    </span>
                  </span>
                )}
              </span>
            )}
          </button>
        </div>
      </td>
      <td className="ad-cell-tag">
        <PersonRole user={user} />
      </td>
      <td className="ad-cell-tag">
        <PersonStatus user={user} />
      </td>
      <td className="ad-cell-tag">
        <PersonTwoFactor user={user} short />
      </td>
      <td
        className="ad-cell-when ad-quiet"
        data-none={user.last_login_at === null && user.temp_password_expires_at === null ? 'true' : undefined}
        // A last sign-in stands at the end of the name's line in a phone's stacked row; a temporary password's expiry ends the meta line.
        data-time={user.last_login_at === null ? undefined : 'true'}
      >
        <div className="ad-when-row">
          {user.last_login_at === null ? (
            user.temp_password_expires_at === null ? (
              <span className="ad-wide ad-never">{tr('users.never')}</span>
            ) : (
              // J4-44: the fact an admin acts on for an account still on its temporary password: when that password stops working.
              <TempExpiry at={user.temp_password_expires_at} />
            )
          ) : (
            <LastSignIn at={user.last_login_at} />
          )}
          <span className="ad-manage" aria-hidden="true">
            <span className="ad-manage-word">{tr('users.manage')}</span>
            <ChevronRight size={16} className="ad-go" />
          </span>
        </div>
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
  const inBar = useInBar();
  const [search, setSearch] = React.useState('');
  const [filter, setFilter] = React.useState<Filter>('all');
  const [twoFactor, setTwoFactor] = React.useState<TwoFactorFilter>('any');
  const [sort, setSort] = React.useState<Sort>({ key: 'name', dir: 'asc' });
  const debounced = useDebounced(search);
  const query = useAdminUsers(debounced);
  const selfId = useSession().data?.user?.id;
  const [dialog, setDialog] = React.useState<Dialog>(null);

  const loaded = React.useMemo(() => query.data?.pages.flatMap((page) => page.users) ?? [], [query.data]);
  // The status and two-factor filters, then the sort, all on the loaded pages.
  const users = React.useMemo(
    () =>
      loaded
        .filter((user) => (filter === 'all' || personState(user) === filter) && twoFactorMatches(user, twoFactor))
        .toSorted(compare(sort)),
    [loaded, filter, twoFactor, sort]
  );
  // How many people each filter shows, once every page is loaded (a count of a part of the list would not be true).
  const counts = React.useMemo(() => {
    const result: Record<Filter, number> = { all: loaded.length, active: 0, pending: 0, disabled: 0 };
    for (const user of loaded) {
      result[personState(user)] += 1;
    }
    return result;
  }, [loaded]);
  const counted = query.data !== undefined && !query.hasNextPage;
  const total = query.data?.pages.at(-1)?.total ?? 0;
  const close = () => setDialog(null);
  const find = (id: string) => loaded.find((user) => user.id === id);
  const managed = dialog?.kind === 'manage' ? find(dialog.id) : undefined;
  const deleting = dialog?.kind === 'delete' ? find(dialog.id) : undefined;

  // The count under the list: "7 people", or "Showing 1 of 7" once a filter or a page limit hides some.
  const countText =
    filter === 'all' && twoFactor === 'any' && !query.hasNextPage
      ? tr('users.people_count', { count: users.length })
      : tr('users.showing', { shown: fmt.number(users.length), total: fmt.number(total) });
  // It is said after every search or filter (the shared live region), not on the first load.
  const said = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (query.data === undefined) {
      return;
    }
    if (said.current !== null && said.current !== countText) {
      announce(countText);
    }
    said.current = countText;
  }, [countText, query.data]);

  const label = (value: Filter, text: string): string =>
    counted ? tr('users.filter_count', { label: text, count: fmt.number(counts[value]) }) : text;
  const withTwoFactor = loaded.filter((user) => user.two_factor).length;
  const twoFactorLabel = (value: Exclude<TwoFactorFilter, 'any'>, text: string): string =>
    counted
      ? tr('users.filter_count', { label: text, count: fmt.number(value === 'on' ? withTwoFactor : loaded.length - withTwoFactor) })
      : text;

  const sortBy = (key: Sort['key']) => {
    setSort((current) => {
      if (current.key === key) {
        return { key, dir: current.dir === 'asc' ? 'desc' : 'asc' };
      }
      // A name sorts A to Z first; a last sign-in, newest first.
      return { key, dir: key === 'name' ? 'asc' : 'desc' };
    });
  };

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
    body = <TableSkeleton label={tr('users.loading')} columns={5} />;
  } else if (loaded.length === 0) {
    body = (
      <EmptyState
        art={<FlightTrail size="md" />}
        title={debounced.trim() === '' ? tr('users.empty') : tr('users.no_match', { query: debounced.trim() })}
        className="ad-empty"
      />
    );
  } else if (users.length === 0) {
    body = (
      <EmptyState
        art={<FlightTrail size="md" />}
        title={tr('users.filter_none')}
        className="ad-empty"
        action={
          <Button
            size="sm"
            onClick={() => {
              setFilter('all');
              setTwoFactor('any');
            }}
          >
            {tr('users.filter_show_all')}
          </Button>
        }
      />
    );
  } else {
    body = (
      <Table label={tr('admin.tab_people')} dense className="ad-table ad-people">
        <thead>
          <tr>
            <SortHeader label={tr('term.account')} sort={sort} column="name" onSort={() => sortBy('name')} className="ad-col-person" />
            <th scope="col" className="ad-col-tag">
              {tr('users.role')}
            </th>
            <th scope="col" className="ad-col-tag">
              {tr('users.col_status')}
            </th>
            <th scope="col" className="ad-col-tag">
              {tr('users.col_two_factor')}
            </th>
            <SortHeader
              label={tr('users.col_last_sign_in')}
              sort={sort}
              column="last"
              onSort={() => sortBy('last')}
              className="ad-col-when"
            />
          </tr>
        </thead>
        <tbody>
          {users.map((user) => (
            <UserRow key={user.id} user={user} onOpen={() => setDialog({ kind: 'manage', id: user.id })} />
          ))}
        </tbody>
        {/* The end of the list, with its count: it closes a short table so the space under it reads as the end of the page. */}
        <tfoot>
          <tr>
            <td colSpan={5} className="ad-table-foot">
              {countText}
            </td>
          </tr>
        </tfoot>
      </Table>
    );
  }

  return (
    <div className="ad-pane">
      <PageHead
        title={tr('admin.tab_people')}
        description={tr('admin.people_desc_short')}
        info={tr('admin.people_desc')}
        action={
          <Button
            variant="primary"
            leadingIcon={<Plus size={16} aria-hidden="true" />}
            aria-label={inBar ? tr('users.add_person') : undefined}
            onClick={() => setDialog({ kind: 'create' })}
          >
            {tr(inBar ? 'common.add' : 'users.add_person')}
          </Button>
        }
      />
      <div className="ad-toolbar">
        <TextField
          type="search"
          variant="search"
          label={tr('users.search_label')}
          hideLabel
          placeholder={tr('users.search_placeholder')}
          leading={<Search size={16} aria-hidden="true" />}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          trailing={
            // The app's own Clear (the browser's search cross is hidden in ui.css): labelled, 24px+, and it puts focus back in the field.
            search === '' ? undefined : (
              <IconButton
                label={tr('app.clear_search')}
                size="sm"
                onClick={(e) => {
                  setSearch('');
                  e.currentTarget.closest('.ui-input')?.querySelector('input')?.focus();
                }}
              >
                <X size={16} strokeWidth={1.75} aria-hidden="true" />
              </IconButton>
            )
          }
        />
        <SegmentedControl<Filter>
          label={tr('users.filter_label')}
          options={[
            { value: 'all', label: label('all', tr('users.filter_all')) },
            { value: 'active', label: label('active', tr('users.status_active')) },
            { value: 'pending', label: label('pending', tr('users.filter_pending')) },
            { value: 'disabled', label: label('disabled', tr('users.status_disabled')) }
          ]}
          value={filter}
          onChange={setFilter}
          size="md"
          wrap
          className="ad-filter"
        />
        <Select
          id="users-two-factor"
          label={tr('users.filter_two_factor_label')}
          hideLabel
          options={[
            { value: 'any', label: tr('users.filter_two_factor_any') },
            { value: 'on', label: twoFactorLabel('on', tr('users.filter_two_factor_on')) },
            { value: 'off', label: twoFactorLabel('off', tr('users.filter_two_factor_off')) }
          ]}
          value={twoFactor}
          onChange={(next) => setTwoFactor(TWO_FACTOR_FILTERS.find((value) => value === next) ?? 'any')}
          className="ad-pill-select"
        />
      </div>
      {body}
      {query.hasNextPage || query.isError ? (
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
          {query.isError ? <ErrorText>{adminErrorText(query.error)}</ErrorText> : null}
        </div>
      ) : null}

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
