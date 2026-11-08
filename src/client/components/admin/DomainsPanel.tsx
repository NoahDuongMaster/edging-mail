import React from 'react';
import { CheckCircle2, XCircle } from 'lucide-react';
import type { ThemeTokens } from '../../theme';
import { domainProblem } from '../../lib/admin/address';
import { useAddDomain, useAdminDomains, useCheckDomain, useRemoveDomain } from '../../lib/admin/domains';
import { adminErrorText } from '../../lib/admin/types';
import type { AdminDomain, DnsCheck } from '../../lib/admin/types';
import { fmt, tRich, useT } from '../../lib/i18n';
import { Badge, Button, Disclosure, EmptyState, Table, TableSkeleton, TextField, VisuallyHidden } from '../../ui';
import { ConfirmDialog } from '../ConfirmDialog';
import { DomainGuide } from './DomainGuide';
import { ErrorText, LoadError } from './adminUi';
import { useAdminAction } from './useAdminAction';

/** Ready or not: the word with an icon (the colour only adds to it). */
const Status: React.FC<{ ready: boolean }> = ({ ready }) => {
  const tr = useT();
  return (
    <Badge tone={ready ? 'success' : 'danger'}>
      {ready ? <CheckCircle2 size={12} aria-hidden="true" /> : <XCircle size={12} aria-hidden="true" />}
      {ready ? tr('domains.ready') : tr('domains.not_ready')}
    </Badge>
  );
};

/** Whether the check found a record of Email Sending: the word in a Badge (a missing record that is not required, DMARC, is a warning). */
const RecordState: React.FC<{ found: boolean; required: boolean }> = ({ found, required }) => {
  const tr = useT();
  if (found) {
    return (
      <Badge tone="success">
        <CheckCircle2 size={12} aria-hidden="true" />
        {tr('domains.record_ok')}
      </Badge>
    );
  }
  return (
    <Badge tone={required ? 'danger' : 'warning'}>
      <XCircle size={12} aria-hidden="true" />
      {tr('domains.record_absent')}
    </Badge>
  );
};

export const DnsResult: React.FC<{ check: DnsCheck }> = ({ check }) => {
  const tr = useT();
  // RFC 7505: a null MX ("0 .", parsed to an empty host) says the domain accepts no mail. It is said in words and never listed as a host.
  const nullMx = check.receiving.mx.some((mx) => mx.host === '');
  const listed = check.receiving.mx.filter((mx) => mx.host !== '');
  // The sentences come from what the check found (the server's own `note` is English text for API clients only).
  let receivingNote: string;
  if (check.receiving.ready) {
    receivingNote = tr('domains.note_mx_cloudflare');
  } else if (nullMx) {
    receivingNote = tr('domains.note_mx_null');
  } else if (listed.length === 0) {
    receivingNote = tr('domains.note_mx_none');
  } else {
    receivingNote = tr('domains.note_mx_other', { hosts: [...new Set(listed.map((mx) => mx.host))].join(', ') });
  }
  let mxList: React.ReactNode = null;
  if (listed.length > 0) {
    mxList = (
      <ul className="ad-mono-list">
        {listed.map((mx) => (
          <li key={`${mx.priority}-${mx.host}`}>
            {mx.priority} {mx.host}
          </li>
        ))}
      </ul>
    );
  } else if (!nullMx) {
    mxList = <p className="ad-muted">{tr('domains.no_mx')}</p>;
  }
  return (
    <div className="ad-dns">
      <section aria-label={tr('domains.receiving')} className="ad-dns-part">
        <div className="ad-dns-head">
          <strong className="ad-dns-title">{tr('domains.receiving')}</strong>
          <Status ready={check.receiving.ready} />
        </div>
        <p className="ad-muted">{receivingNote}</p>
        {mxList}
      </section>
      <section aria-label={tr('domains.sending')} className="ad-dns-part">
        <div className="ad-dns-head">
          <strong className="ad-dns-title">{tr('domains.sending')}</strong>
          <Status ready={check.sending.ready} />
        </div>
        <p className="ad-muted">{check.sending.ready ? tr('domains.note_sending_ready') : tr('domains.note_sending_missing')}</p>
        <ul className="ad-records">
          {check.sending.records.map((record) => (
            <li key={`${record.type}-${record.name}`} className="ad-record">
              <span className="ad-record-name">
                {record.type} {record.name}
              </span>
              <RecordState found={record.found} required={record.required !== false} />
            </li>
          ))}
        </ul>
      </section>
      <p className="ad-muted ad-dns-when">{tr('domains.checked_at', { when: fmt.dateTime(check.checked_at) })}</p>
    </div>
  );
};

/** One domain: its row of buttons, and under it (in a row of its own) the DNS answer and the setup steps once they are asked for. */
const DomainRow: React.FC<{ t: ThemeTokens; domain: AdminDomain; onRemove: () => void; removing: boolean }> = ({
  t,
  domain,
  onRemove,
  removing
}) => {
  const tr = useT();
  const check = useCheckDomain();
  const [guide, setGuide] = React.useState(false);
  const panelId = React.useId();
  const open = guide || check.isError || check.data !== undefined;
  return (
    <>
      <tr data-open={open ? 'true' : undefined}>
        <td className="ad-cell-domain ad-wrap">
          <span className="ad-cell-title">{domain.name}</span>
          <span className="ad-sub">{tr('domains.addresses_count', { count: domain.addresses_count })}</span>
        </td>
        <td className="ad-cell-actions ad-end">
          <div className="ad-actions">
            <Button variant="ghost" size="sm" disabled={check.isPending} loading={check.isPending} onClick={() => check.mutate(domain.id)}>
              {check.isPending ? tr('admin.checking') : tr('admin.check_dns')}
            </Button>
            <Disclosure look="button" open={guide} onOpenChange={setGuide} controls={panelId}>
              {guide ? tr('domains.hide_steps') : tr('domains.show_steps')}
            </Disclosure>
            <Button variant="danger" size="sm" disabled={removing} onClick={onRemove}>
              {tr('common.remove')}
            </Button>
          </div>
        </td>
      </tr>
      {open ? (
        <tr className="ad-detail">
          <td colSpan={2}>
            <div className="ad-detail-body">
              {check.isError ? <ErrorText>{adminErrorText(check.error)}</ErrorText> : null}
              {check.data === undefined ? null : <DnsResult check={check.data} />}
              {guide ? (
                <div id={panelId}>
                  <DomainGuide t={t} domain={domain.name} />
                </div>
              ) : null}
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
};

export const DomainsPanel: React.FC<{ t: ThemeTokens }> = ({ t }) => {
  const tr = useT();
  const domains = useAdminDomains();
  const add = useAddDomain();
  const remove = useRemoveDomain();
  const addAction = useAdminAction();
  const removeAction = useAdminAction();
  const [value, setValue] = React.useState('');
  const [touched, setTouched] = React.useState(false);
  const [removeTarget, setRemoveTarget] = React.useState<AdminDomain | null>(null);
  const name = value.trim().toLowerCase();
  const problem = touched && name !== '' ? domainProblem(name) : null;

  const submit = async (event: React.SyntheticEvent) => {
    event.preventDefault();
    setTouched(true);
    if (addAction.busy || domainProblem(name) !== null) {
      return;
    }
    if (await addAction.run(() => add.mutateAsync(name))) {
      setValue('');
      setTouched(false);
    }
  };

  const confirmRemove = async () => {
    if (removeTarget === null) {
      return;
    }
    const target = removeTarget;
    setRemoveTarget(null);
    await removeAction.run(() => remove.mutateAsync(target.id));
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
    list = <TableSkeleton label={tr('domains.loading')} />;
  } else if (domains.data.length === 0) {
    list = <EmptyState title={tr('domains.empty')} />;
  } else {
    list = (
      <Table label={tr('admin.tab_domains')} dense className="ad-table">
        <thead>
          <tr>
            <th scope="col">{tr('term.domain')}</th>
            <th scope="col" className="ad-end">
              <VisuallyHidden>{tr('admin.col_actions')}</VisuallyHidden>
            </th>
          </tr>
        </thead>
        <tbody>
          {domains.data.map((domain) => (
            <DomainRow key={domain.id} t={t} domain={domain} removing={removeAction.busy} onRemove={() => setRemoveTarget(domain)} />
          ))}
        </tbody>
      </Table>
    );
  }

  return (
    <div className="ad-pane">
      <form
        noValidate
        onSubmit={(event) => {
          void submit(event);
        }}
        className="ad-field-group"
      >
        <div className="ad-inline">
          <TextField
            id="domain-new"
            label={tr('domains.add_a_domain')}
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
          <Button type="submit" variant="primary" disabled={addAction.busy} loading={addAction.busy}>
            {tr('domains.add_domain')}
          </Button>
        </div>
        {problem === null ? null : <ErrorText id="domain-new-error">{problem}</ErrorText>}
      </form>
      {addAction.error === null ? null : <ErrorText>{addAction.error}</ErrorText>}
      <p className="ad-muted ad-note">{tRich('domains.add_note', { check: <Badge>{tr('admin.check_dns')}</Badge> })}</p>
      {removeAction.error === null ? null : <ErrorText>{removeAction.error}</ErrorText>}
      {list}
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
