import React from 'react';
import { BookOpen, CheckCircle2, CircleDashed, Plus, RefreshCw, TriangleAlert, XCircle } from 'lucide-react';
import type { ThemeTokens } from '../../theme';
import { domainProblem } from '../../lib/admin/address';
import { useAddDomain, useAdminDomains, useCheckDomain, useRemoveDomain } from '../../lib/admin/domains';
import { adminErrorText } from '../../lib/admin/types';
import type { AdminDomain, DnsCheck } from '../../lib/admin/types';
import { announce } from '../../lib/announce';
import { fmt, useT } from '../../lib/i18n';
import {
  Badge,
  Button,
  Card,
  CopyButton,
  Disclosure,
  DisclosurePanel,
  EmptyState,
  FlightTrail,
  Skeleton,
  Step,
  Steps,
  TextField,
  useMediaMatch
} from '../../ui';
import { ConfirmDialog } from '../ConfirmDialog';
import { DomainGuideDialog } from './DomainGuide';
import { DashboardLink, ErrorText, Group, LoadError, ModalFrame, PageHead, PHONE_LAYOUT, StateWord } from './adminUi';
import { useAdminAction } from './useAdminAction';

/** Ready or not: the word after its icon, in the tone of the answer (the words say it; the colour only adds to it). */
const Status: React.FC<{ ready: boolean }> = ({ ready }) => {
  const tr = useT();
  return ready ? (
    <StateWord icon={<CheckCircle2 size={14} />} tone="success">
      {tr('domains.ready')}
    </StateWord>
  ) : (
    <StateWord icon={<XCircle size={14} />} tone="danger">
      {tr('domains.not_ready')}
    </StateWord>
  );
};

/**
 * What a domain can do, in one phrase that is true to the last check: both work, one of the two works (and which), or neither. Before any
 * check it says so. The one badge of a card, next to its name.
 */
const Summary: React.FC<{ check: DnsCheck | undefined }> = ({ check }) => {
  const tr = useT();
  if (check === undefined) {
    return (
      <Badge>
        <CircleDashed size={12} aria-hidden="true" />
        {tr('domains.not_checked')}
      </Badge>
    );
  }
  const receiving = check.receiving.ready;
  const sending = check.sending.ready;
  if (receiving && sending) {
    return (
      <Badge tone="success">
        <CheckCircle2 size={12} aria-hidden="true" />
        {tr('domains.summary_ready')}
      </Badge>
    );
  }
  if (receiving || sending) {
    return (
      <Badge tone="warning">
        <TriangleAlert size={12} aria-hidden="true" />
        {receiving ? tr('domains.summary_receiving_only') : tr('domains.summary_sending_only')}
      </Badge>
    );
  }
  return (
    <Badge tone="danger">
      <XCircle size={12} aria-hidden="true" />
      {tr('domains.summary_none')}
    </Badge>
  );
};

/** Whether the check found a record of Email Sending, as a word after its icon (a missing record that is not required, DMARC, is a warning). */
const RecordState: React.FC<{ found: boolean; required: boolean }> = ({ found, required }) => {
  const tr = useT();
  if (found) {
    return (
      <StateWord icon={<CheckCircle2 size={14} />} tone="success">
        {tr('domains.record_ok')}
      </StateWord>
    );
  }
  return (
    <StateWord icon={<XCircle size={14} />} tone={required ? 'danger' : 'warning'}>
      {tr('domains.record_absent')}
    </StateWord>
  );
};

/** Copy for a host name of a record (where the admin types it at a DNS provider): named by the host, so each Copy of a list says which. */
const CopyHost: React.FC<{ host: string }> = ({ host }) => {
  const tr = useT();
  return <CopyButton text={host} size="sm" variant="ghost" aria-label={tr('domains.copy_record', { name: host })} className="adm-copy" />;
};

/**
 * One DNS record of Email Sending: its type, its host name with Copy, and whether the check found it. A missing one says where its value
 * is: the app cannot know it (Cloudflare makes it when the domain is onboarded), and the step's dashboard link is right above.
 */
const RecordRow: React.FC<{ record: DnsCheck['sending']['records'][number] }> = ({ record }) => {
  const tr = useT();
  return (
    <li className="adm-record">
      <span className="adm-rtype">{record.type}</span>
      <span className="adm-record-name" translate="no">
        {record.name}
      </span>
      <span className="adm-record-end">
        <RecordState found={record.found} required={record.required !== false} />
        <CopyHost host={record.name} />
      </span>
      {record.found ? null : <span className="adm-record-hint">{tr('domains.record_value_hint')}</span>}
    </li>
  );
};

/** The DNS record type of the receiving rows: a protocol name, never translated. */
const MX_TYPE = 'MX';

/** The order of the records of Email Sending: a missing required record, a missing optional one, a record that was found. */
const recordRank = (record: DnsCheck['sending']['records'][number]): number => {
  if (record.found) {
    return 2;
  }
  return record.required === false ? 1 : 0;
};

/** One step of the DNS checklist (receiving or sending): what it is, whether it works, what the check found, where to fix it. */
interface Part {
  title: string;
  ready: boolean;
  /** What the check found that is missing (null for a step that works: its Ready says it). */
  note: string | null;
  /** The way to the page of the Cloudflare dashboard where the step is set up. */
  path: string;
  records: React.ReactNode;
}

/**
 * A numbered step of the checklist (ui Step): its name and whether it works on the first line, what the check found under it. A step that
 * works keeps its records folded (they open on request); a step that does not work is open: a link to the Cloudflare dashboard with the way
 * to the page, and the records with what is missing first.
 */
const DnsStep: React.FC<{ part: Part }> = ({ part }) => {
  const tr = useT();
  const [open, setOpen] = React.useState(!part.ready);
  const panelId = React.useId();
  return (
    <Step>
      <section aria-label={part.title} className="adm-dns-part" data-ready={part.ready ? 'true' : 'false'}>
        <div className="adm-dns-head">
          <strong className="adm-dns-title">{part.title}</strong>
          <Status ready={part.ready} />
        </div>
        {part.note === null ? null : <p className="adm-dns-line">{part.note}</p>}
        <div className="adm-dns-tools">
          <Disclosure open={open} onOpenChange={setOpen} controls={panelId} look="button" className="adm-toggle">
            {open ? tr('domains.hide_records') : tr('domains.show_records')}
          </Disclosure>
          {part.ready ? null : <DashboardLink path={part.path} />}
        </div>
        <DisclosurePanel id={panelId} open={open} className="adm-dns-panel">
          <div className="adm-dns-records">{part.records}</div>
        </DisclosurePanel>
      </section>
    </Step>
  );
};

/**
 * What the last DNS check found, as a numbered checklist (ui Steps) of receiving (the MX records) and sending (each record of Email
 * Sending): the step that does not work first and open, a step that works folded to its line. The numbers are the order to work in.
 */
export const DnsResult: React.FC<{ check: DnsCheck }> = ({ check }) => {
  const tr = useT();
  // RFC 7505: a null MX ("0 .", parsed to an empty host) says the domain accepts no mail. It is said in words and never listed as a host.
  const nullMx = check.receiving.mx.some((mx) => mx.host === '');
  const listed = check.receiving.mx.filter((mx) => mx.host !== '');
  // The sentences come from what the check found (the server's own `note` is English text for API clients only); a step that works has
  // none (its Ready says it).
  let receivingNote: string | null = null;
  if (check.receiving.ready) {
    // Nothing to add to its Ready.
  } else if (nullMx) {
    receivingNote = tr('domains.note_mx_null');
  } else if (listed.length === 0) {
    receivingNote = tr('domains.note_mx_none');
  } else {
    receivingNote = tr('domains.note_mx_other', { hosts: [...new Set(listed.map((mx) => mx.host))].join(', ') });
  }
  let mxList: React.ReactNode = null;
  if (listed.length > 0) {
    // The MX hosts the domain points to, in the same rows as the records of Email Sending: type, host, and the priority where a status would be.
    mxList = (
      <ul className="adm-records">
        {listed.map((mx) => (
          <li key={`${mx.priority}-${mx.host}`} className="adm-record">
            <span className="adm-rtype">{MX_TYPE}</span>
            <span className="adm-record-name" translate="no">
              {mx.host}
            </span>
            <span className="adm-record-end">
              <span className="adm-muted">{tr('domains.mx_priority', { priority: mx.priority })}</span>
              <CopyHost host={mx.host} />
            </span>
          </li>
        ))}
      </ul>
    );
  } else if (!nullMx) {
    mxList = <p className="adm-muted">{tr('domains.no_mx')}</p>;
  }
  const receiving: Part = {
    title: tr('domains.receiving'),
    ready: check.receiving.ready,
    note: receivingNote,
    path: tr('domains.guide_path_routing'),
    records: mxList
  };
  const sending: Part = {
    title: tr('domains.sending'),
    ready: check.sending.ready,
    note: check.sending.ready
      ? null
      : tr('domains.records_missing', { count: check.sending.records.filter((record) => !record.found).length }),
    path: tr('domains.guide_path_sending'),
    records: (
      <ul className="adm-records">
        {/* What is missing first (required, then optional), then what was found: the row to act on is never under the fold. */}
        {check.sending.records
          .toSorted((a, b) => recordRank(a) - recordRank(b))
          .map((record) => (
            <RecordRow key={`${record.type}-${record.name}`} record={record} />
          ))}
      </ul>
    )
  };
  // The step to act on comes first; two steps that work, or two that do not, keep their order (receiving, then sending).
  const parts = check.sending.ready || !check.receiving.ready ? [receiving, sending] : [sending, receiving];
  return (
    <Steps className="adm-checklist">
      {parts.map((part) => (
        // Keyed by its state as well: a step that a new check finds working folds, one that breaks opens.
        <DnsStep key={`${part.title}-${String(part.ready)}`} part={part} />
      ))}
    </Steps>
  );
};

/** When a check ran, short: the time alone today, the date and time on another day. */
function checkedWhen(at: number): string {
  return new Date(at).toDateString() === new Date().toDateString()
    ? fmt.time(at)
    : fmt.dateTime(at, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

interface DomainCardProps {
  t: ThemeTokens;
  domain: AdminDomain;
  onRemove: () => void;
  removing: boolean;
  /** Why the last Remove of this domain failed (shown on this card, naming the domain), or null. */
  removeError: string | null;
}

/**
 * One domain as a card: its name, how many addresses it has and what it can do after the last check (the card's one badge); in its head the
 * check (Check DNS, the same button every time; the answer is said by the live region as well as shown) and Remove, quiet and apart; the
 * numbered DNS checklist in its body and, at its foot, the setup steps in a dialog. A domain that addresses use cannot be removed (the server
 * refuses it): its head says "In use" instead of offering a Remove that can only fail (J4-31), and it is checked once when the page opens,
 * so it never reads "Not checked yet" while mail depends on it (J4-27).
 */
const DomainCard: React.FC<DomainCardProps> = ({ t, domain, onRemove, removing, removeError }) => {
  const tr = useT();
  const check = useCheckDomain();
  const [guide, setGuide] = React.useState(false);
  const result = check.data;
  const inUse = domain.addresses_count > 0;
  const addresses = tr('domains.addresses_count', { count: domain.addresses_count });

  // Once per card (a ref, so StrictMode's second effect run does not ask again), quietly: the result is shown, not announced.
  const { mutate } = check;
  const autoChecked = React.useRef(false);
  React.useEffect(() => {
    if (inUse && !autoChecked.current) {
      autoChecked.current = true;
      mutate(domain.id);
    }
  }, [inUse, mutate, domain.id]);

  const runCheck = () => {
    check.mutate(domain.id, {
      onSuccess: (answer) => {
        const both = answer.receiving.ready && answer.sending.ready;
        announce(tr(both ? 'domains.check_ready' : 'domains.check_not_ready', { name: domain.name }));
      }
    });
  };

  const checkLabel = check.isPending ? tr('admin.checking') : tr('admin.check_dns');

  return (
    <li className="adm-domain">
      <Card
        title={domain.name}
        headingLevel={3}
        description={
          // J3-38: every card has the same head: the count always first in the meta line, then the state of the last check.
          <span className="adm-domain-meta">
            <span>{addresses}</span>
            <Summary check={result} />
            {result === undefined ? null : (
              <span className="adm-checked">{tr('domains.checked_at', { when: checkedWhen(result.checked_at) })}</span>
            )}
          </span>
        }
        actions={
          // A fixed column: Check DNS first, then Remove or, where addresses use the domain, a quiet "In use" in its place (same width).
          <>
            <Button size="sm" leadingIcon={<RefreshCw size={14} aria-hidden="true" />} loading={check.isPending} onClick={runCheck}>
              {checkLabel}
            </Button>
            {inUse ? (
              <span className="adm-in-use">{tr('domains.in_use')}</span>
            ) : (
              <Button variant="ghost" size="sm" className="adm-remove" disabled={removing} onClick={onRemove}>
                {tr('common.remove')}
              </Button>
            )}
          </>
        }
        className="adm-domain-card"
      >
        <div className="adm-domain-body">
          {removeError === null ? null : <ErrorText>{tr('domains.remove_failed', { name: domain.name, reason: removeError })}</ErrorText>}
          {check.isError ? <ErrorText>{adminErrorText(check.error)}</ErrorText> : null}
          {result === undefined ? null : <DnsResult check={result} />}
          <div className="adm-domain-foot">
            <Button
              variant="ghost"
              size="sm"
              className="adm-toggle"
              leadingIcon={<BookOpen size={16} strokeWidth={1.75} aria-hidden="true" />}
              aria-haspopup="dialog"
              onClick={() => setGuide(true)}
            >
              {tr('domains.show_steps')}
            </Button>
          </div>
        </div>
      </Card>
      {guide ? <DomainGuideDialog t={t} domain={domain.name} onClose={() => setGuide(false)} /> : null}
    </li>
  );
};

/** The form that adds a domain; on a phone its Add domain is in the foot of its dialog, outside it. */
const ADD_FORM = 'domain-add';

export const DomainsPanel: React.FC<{ t: ThemeTokens }> = ({ t }) => {
  const tr = useT();
  const domains = useAdminDomains();
  const add = useAddDomain();
  const remove = useRemoveDomain();
  const addAction = useAdminAction();
  const removeAction = useAdminAction();
  // A phone adds a domain in a dialog opened from the console's top bar (the page starts with the domains); a desktop in the page.
  const phone = useMediaMatch(PHONE_LAYOUT);
  const [adding, setAdding] = React.useState(false);
  const [value, setValue] = React.useState('');
  const [touched, setTouched] = React.useState(false);
  const [removeTarget, setRemoveTarget] = React.useState<AdminDomain | null>(null);
  // The domain whose last Remove failed: its card shows why (removeAction.error), not the top of the page.
  const [removeFailed, setRemoveFailed] = React.useState<string | null>(null);
  const name = value.trim().toLowerCase();
  const problem = touched && name !== '' ? domainProblem(name) : null;

  const submit = async (event: React.SyntheticEvent) => {
    event.preventDefault();
    setTouched(true);
    if (addAction.busy || domainProblem(name) !== null) {
      return;
    }
    if (await addAction.run(() => add.mutateAsync(name))) {
      announce(tr('domains.added', { name }));
      setValue('');
      setTouched(false);
      setAdding(false);
    }
  };

  const closeAdding = () => {
    setAdding(false);
    setTouched(false);
    addAction.clearError();
  };

  const confirmRemove = async () => {
    if (removeTarget === null) {
      return;
    }
    const target = removeTarget;
    setRemoveTarget(null);
    setRemoveFailed(null);
    if (!(await removeAction.run(() => remove.mutateAsync(target.id)))) {
      setRemoveFailed(target.id);
    }
  };

  let list: React.ReactNode;
  if (domains.isError && domains.data === undefined) {
    list = (
      <LoadError
        error={domains.error}
        onRetry={() => {
          void domains.refetch();
        }}
      />
    );
  } else if (domains.data === undefined) {
    list = (
      <div role="status" aria-label={tr('domains.loading')} className="adm-domains-loading">
        <Skeleton height={148} />
        <Skeleton height={148} />
      </div>
    );
  } else if (domains.data.length === 0) {
    list = <EmptyState art={<FlightTrail size="md" />} title={tr('domains.empty')} className="adm-empty" />;
  } else {
    list = (
      <ul aria-label={tr('admin.tab_domains')} className="adm-domains">
        {domains.data.map((domain) => (
          <DomainCard
            key={domain.id}
            t={t}
            domain={domain}
            removing={removeAction.busy}
            removeError={removeFailed === domain.id ? removeAction.error : null}
            onRemove={() => setRemoveTarget(domain)}
          />
        ))}
      </ul>
    );
  }

  const addButton = (
    <Button
      type="submit"
      form={ADD_FORM}
      variant="primary"
      leadingIcon={<Plus size={16} aria-hidden="true" />}
      disabled={addAction.busy}
      loading={addAction.busy}
    >
      {tr('domains.add_domain')}
    </Button>
  );
  // The field says what adding does in an InfoTip after its label; the line under it keeps the consequence (DESIGN-v4m R1).
  const addForm = (
    <form
      id={ADD_FORM}
      noValidate
      onSubmit={(event) => {
        void submit(event);
      }}
      className="adm-field-group adm-add-domain"
    >
      <div className="adm-inline">
        <TextField
          id="domain-new"
          label={tr(phone ? 'term.domain' : 'domains.add_a_domain')}
          hint={tr('domains.add_note', { check: tr('admin.check_dns') })}
          inputMode="url"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          autoComplete="off"
          placeholder={tr('domains.name_placeholder')}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={() => setTouched(true)}
          aria-invalid={problem !== null}
          aria-describedby={problem === null ? undefined : 'domain-new-error'}
        />
        {phone ? null : addButton}
      </div>
      {problem === null ? null : <ErrorText id="domain-new-error">{problem}</ErrorText>}
      <p className="adm-muted adm-note">{tr('domains.add_note_short')}</p>
      {addAction.error === null ? null : <ErrorText>{addAction.error}</ErrorText>}
    </form>
  );

  return (
    <div className="adm-pane" data-width="narrow">
      <PageHead
        title={tr('admin.tab_domains')}
        description={tr('admin.domains_desc_short')}
        info={tr('admin.domains_desc')}
        action={
          phone ? (
            <Button
              variant="primary"
              leadingIcon={<Plus size={16} aria-hidden="true" />}
              aria-haspopup="dialog"
              aria-label={tr('domains.add_domain')}
              onClick={() => setAdding(true)}
            >
              {tr('common.add')}
            </Button>
          ) : undefined
        }
      />
      {phone ? null : <Group>{addForm}</Group>}
      {list}
      {phone && adding ? (
        <ModalFrame
          t={t}
          title={tr('domains.add_a_domain')}
          onClose={closeAdding}
          locked={addAction.busy}
          footer={
            <>
              <Button onClick={closeAdding} disabled={addAction.busy}>
                {tr('common.cancel')}
              </Button>
              {addButton}
            </>
          }
        >
          {addForm}
        </ModalFrame>
      ) : null}
      <ConfirmDialog
        isOpen={removeTarget !== null}
        t={t}
        title={tr('domains.remove_title', { name: removeTarget?.name ?? '' })}
        body={tr('domains.remove_body')}
        confirmLabel={tr('domains.remove_domain')}
        onConfirm={() => {
          void confirmRemove();
        }}
        onCancel={() => setRemoveTarget(null)}
      />
    </div>
  );
};
