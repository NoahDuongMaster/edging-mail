import React from 'react';
import { TriangleAlert, UserRound } from 'lucide-react';
import { avatarHue, type ThemeTokens } from '../../theme';
import { fmt, tDyn, useT, type TFunction } from '../../lib/i18n';
import { useAdminAudit } from '../../lib/admin/audit';
import { adminErrorText, detailLine, type AuditEntry } from '../../lib/admin/types';
import { Avatar, Button, EmptyState, FlightTrail, ListSkeleton, SegmentedControl, Select } from '../../ui';
import { ErrorText, LoadError, PageHead } from './adminUi';

/** The sentence for an audit action code (`audit.action.<code>`); a code this client does not know is named as it is, never hidden or shown as a bare key. */
const actionLabel = (action: string, tr: TFunction): string => tDyn(`audit.action.${action}`) ?? tr('audit.action_unknown', { action });

type Kind = 'all' | 'accounts' | 'domains' | 'security' | 'settings';

/** The date filter: the last 7 days (the default, as in other admin consoles), the last 30, or everything. */
type Range = '7' | '30' | 'all';
const RANGES: readonly Range[] = ['7', '30', 'all'];
const DAY_MS = 24 * 60 * 60 * 1000;

/** The oldest time an event may have to be shown under `range` (0: no limit). */
const rangeStart = (range: Range, now: number): number => (range === 'all' ? 0 : now - Number(range) * DAY_MS);

/** The family of an action code, for the Event filter: accounts and their addresses, domains, the organisation's settings, or sign-in and security. */
function kindOf(action: string): Exclude<Kind, 'all'> {
  if (action.startsWith('user.') || action.startsWith('alias.') || action === 'temp_password_reissued') {
    return 'accounts';
  }
  if (action.startsWith('domain.')) {
    return 'domains';
  }
  if (action.startsWith('settings.') || action === 'setup') {
    return 'settings';
  }
  return 'security';
}

const dayKey = (at: number): string => {
  const date = new Date(at);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
};

/** The heading of a day of the log: Today, Yesterday, or the date with its weekday. */
function dayLabel(at: number, tr: TFunction): string {
  const today = new Date();
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  if (dayKey(at) === dayKey(today.getTime())) {
    return tr('list.group_today');
  }
  if (dayKey(at) === dayKey(yesterday.getTime())) {
    return tr('list.group_yesterday');
  }
  // The year only when it is not this one.
  const sameYear = new Date(at).getFullYear() === today.getFullYear();
  return fmt.date(
    at,
    sameYear ? { weekday: 'long', day: 'numeric', month: 'long' } : { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }
  );
}

/** Entries in a row of the same day, newest first as the server sends them. */
function byDay(entries: readonly AuditEntry[]): { key: string; at: number; entries: AuditEntry[] }[] {
  const days: { key: string; at: number; entries: AuditEntry[] }[] = [];
  for (const entry of entries) {
    const key = dayKey(entry.at);
    const last = days.at(-1);
    if (last?.key === key) {
      last.entries.push(entry);
    } else {
      days.push({ key, at: entry.at, entries: [entry] });
    }
  }
  return days;
}

/** Actions that are a failure or a refusal: drawn with a warning tile instead of the actor's initials, so they stand out in a day. */
const FAILURES = new Set(['sign_in_failed', 'temp_password_expired']);

/** Who did it, in words: an address as it is, the server's scheduled job by name; anything else names nobody (the row names the target). */
function actorName(actor: string, tr: TFunction): string | null {
  if (actor.includes('@')) {
    return actor;
  }
  return actor === 'scheduled job' ? tr('audit.actor_scheduled') : null;
}

/**
 * One event on the log's line: who did it (their initials on their tint; a warning tile for a failure, a plain one when nobody is known) as
 * the dot of the timeline, what was done, by whom to whom with the details, and the time of day (the day, Today or Yesterday or its date,
 * is the heading above it).
 */
const Event: React.FC<{ entry: AuditEntry }> = ({ entry }) => {
  const tr = useT();
  const detail = detailLine(entry.detail);
  const failed = FAILURES.has(entry.action);
  const known = entry.actor_email.includes('@');
  let tile: React.ReactNode;
  if (failed) {
    tile = (
      <span className="ad-event-tile" data-tone="warning">
        <TriangleAlert size={14} aria-hidden="true" />
      </span>
    );
  } else if (known) {
    tile = <Avatar name={entry.actor_email} size="sm" hue={avatarHue(entry.actor_email)} />;
  } else {
    tile = (
      <span className="ad-event-tile">
        <UserRound size={14} aria-hidden="true" />
      </span>
    );
  }
  // A person who acted on their own account (a sign-in) is named once, not as "a → a"; so is a change of the organisation's settings.
  const actor = actorName(entry.actor_email, tr);
  const self = entry.target === '' || entry.target === entry.actor_email || entry.action.startsWith('settings.');
  let who: string;
  if (actor === null) {
    who = entry.target;
  } else {
    who = self ? actor : tr('audit.actor_to_target', { actor, target: entry.target });
  }
  return (
    <li className="ad-event" data-tone={failed ? 'warning' : undefined}>
      {tile}
      <div className="ad-event-text">
        <p className="ad-event-action">{actionLabel(entry.action, tr)}</p>
        <p className="ad-event-who ad-wrap">
          <span>{who}</span>
          {detail === '' ? null : <span className="ad-event-detail">{detail}</span>}
        </p>
      </div>
      <time className="ad-event-time" dateTime={new Date(entry.at).toISOString()}>
        {fmt.time(entry.at)}
      </time>
    </li>
  );
};

export const AuditPanel: React.FC<{ t: ThemeTokens }> = () => {
  const tr = useT();
  const query = useAdminAudit();
  const [kind, setKind] = React.useState<Kind>('all');
  const [person, setPerson] = React.useState('');
  const [range, setRange] = React.useState<Range>('7');
  const loaded = React.useMemo(() => query.data?.pages.flatMap((page) => page.entries) ?? [], [query.data]);
  const people = React.useMemo(() => [...new Set(loaded.map((entry) => entry.actor_email))].toSorted(), [loaded]);
  // The filters work on the pages already loaded, newest first; Load more brings older ones in under the same filters. The date range
  // counts back from when the panel opened or the range was chosen.
  const [rangeFrom, setRangeFrom] = React.useState(() => Date.now());
  const chooseRange = (next: Range) => {
    setRange(next);
    setRangeFrom(Date.now());
  };
  const since = rangeStart(range, rangeFrom);
  const entries = loaded.filter(
    (entry) => entry.at >= since && (kind === 'all' || kindOf(entry.action) === kind) && (person === '' || entry.actor_email === person)
  );
  // Every event of the range is in: a loaded event is older than its start (or there is nothing more to load).
  const oldest = loaded.at(-1)?.at;
  const rangeComplete = range !== 'all' && oldest !== undefined && oldest < since;
  const head = <PageHead title={tr('term.audit_log')} description={tr('audit.intro')} />;

  if (query.isError && query.data === undefined) {
    return (
      <div className="ad-pane" data-width="narrow">
        {head}
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
      <div className="ad-pane" data-width="narrow">
        {head}
        <ListSkeleton label={tr('audit.loading')} rows={6} lines={2} />
      </div>
    );
  }
  if (loaded.length === 0) {
    return (
      <div className="ad-pane" data-width="narrow">
        {head}
        <EmptyState art={<FlightTrail size="md" />} title={tr('audit.empty')} className="ad-empty" />
      </div>
    );
  }

  return (
    <div className="ad-pane" data-width="narrow">
      {head}
      <div className="ad-toolbar ad-filters">
        <Select
          id="audit-kind"
          label={tr('audit.filter_kind')}
          hideLabel
          className="ad-pill-select"
          options={[
            { value: 'all', label: tr('audit.kind_all') },
            { value: 'accounts', label: tr('audit.kind_accounts') },
            { value: 'domains', label: tr('admin.tab_domains') },
            { value: 'security', label: tr('audit.kind_security') },
            { value: 'settings', label: tr('audit.kind_settings') }
          ]}
          value={kind}
          onChange={(next) => {
            const found = (['all', 'accounts', 'domains', 'security', 'settings'] as const).find((value) => value === next);
            setKind(found ?? 'all');
          }}
        />
        <Select
          id="audit-person"
          label={tr('audit.filter_person')}
          hideLabel
          className="ad-pill-select"
          options={[
            { value: '', label: tr('audit.person_all') },
            ...people.map((email) => ({ value: email, label: actorName(email, tr) ?? email }))
          ]}
          value={person}
          onChange={setPerson}
        />
        {/* The period as a segmented control: the last 7 days first, All time one press away. */}
        <SegmentedControl<Range>
          label={tr('audit.filter_date')}
          options={[
            { value: '7', label: tr('audit.range_7') },
            { value: '30', label: tr('audit.range_30') },
            { value: 'all', label: tr('audit.range_all') }
          ]}
          value={range}
          onChange={(next) => chooseRange(RANGES.find((value) => value === next) ?? '7')}
          size="md"
          wrap
          className="ad-filter ad-range"
        />
      </div>
      {entries.length === 0 ? (
        <EmptyState
          art={<FlightTrail size="md" />}
          title={tr('audit.filter_none')}
          className="ad-empty"
          action={
            <Button
              size="sm"
              onClick={() => {
                setKind('all');
                setPerson('');
                chooseRange('all');
              }}
            >
              {tr('audit.filter_clear')}
            </Button>
          }
        />
      ) : (
        <div className="ad-timeline">
          {byDay(entries).map((day) => (
            <section key={day.key} aria-labelledby={`audit-day-${day.key}`} className="ad-day">
              <h3 id={`audit-day-${day.key}`} className="ad-day-title">
                {dayLabel(day.at, tr)}
              </h3>
              <ol className="ad-events">
                {day.entries.map((entry) => (
                  <Event key={entry.id} entry={entry} />
                ))}
              </ol>
            </section>
          ))}
        </div>
      )}
      <div className="ad-foot">
        {rangeComplete ? (
          <>
            <span>{tr('audit.end_range')}</span>
            <Button size="sm" onClick={() => chooseRange('all')}>
              {tr('audit.show_older')}
            </Button>
          </>
        ) : null}
        {!rangeComplete && query.hasNextPage ? (
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
        {!rangeComplete && !query.hasNextPage ? <span>{tr('audit.end')}</span> : null}
        {query.isError ? <ErrorText>{adminErrorText(query.error)}</ErrorText> : null}
      </div>
    </div>
  );
};
