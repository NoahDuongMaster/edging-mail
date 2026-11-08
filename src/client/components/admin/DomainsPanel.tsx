import React from 'react';
import { CheckCircle2, ChevronDown, Loader2, XCircle } from 'lucide-react';
import type { ThemeTokens } from '../../theme';
import { domainProblem } from '../../lib/admin/address';
import { useAddDomain, useAdminDomains, useCheckDomain, useRemoveDomain } from '../../lib/admin/domains';
import { adminErrorText } from '../../lib/admin/types';
import type { AdminDomain, DnsCheck } from '../../lib/admin/types';
import { fmt, tRich, useT } from '../../lib/i18n';
import { ConfirmDialog } from '../ConfirmDialog';
import { DomainGuide } from './DomainGuide';
import { Loading } from './TempPasswordDialog';
import { Badge, adminStyles } from './adminUi';
import { useAdminAction } from './useAdminAction';

const Status: React.FC<{ t: ThemeTokens; ready: boolean }> = ({ t, ready }) => {
  const tr = useT();
  const s = adminStyles(t);
  const color = ready ? s.good : s.danger;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color, fontWeight: 600 }}>
      {ready ? <CheckCircle2 size={16} aria-hidden="true" /> : <XCircle size={16} aria-hidden="true" />}
      {ready ? tr('domains.ready') : tr('domains.not_ready')}
    </span>
  );
};

const DnsResult: React.FC<{ t: ThemeTokens; check: DnsCheck }> = ({ t, check }) => {
  const tr = useT();
  const s = adminStyles(t);
  const mono: React.CSSProperties = { fontFamily: "'Geist Mono', ui-monospace, monospace", fontSize: 12.5, overflowWrap: 'anywhere' };
  // The sentences come from what the check found (the server's own `note` is English text for API clients only).
  let receivingNote: string;
  if (check.receiving.ready) {
    receivingNote = tr('domains.note_mx_cloudflare');
  } else if (check.receiving.mx.length === 0) {
    receivingNote = tr('domains.note_mx_none');
  } else {
    receivingNote = tr('domains.note_mx_other', { hosts: [...new Set(check.receiving.mx.map((mx) => mx.host))].join(', ') });
  }
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <section aria-label={tr('domains.receiving')} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <strong style={{ fontSize: 13 }}>{tr('domains.receiving')}</strong>
          <Status t={t} ready={check.receiving.ready} />
        </div>
        <p style={s.muted}>{receivingNote}</p>
        {check.receiving.mx.length === 0 ? (
          <p style={s.muted}>{tr('domains.no_mx')}</p>
        ) : (
          <ul style={{ margin: 0, paddingLeft: 18, color: t.text2 }}>
            {check.receiving.mx.map((mx) => (
              <li key={`${mx.priority}-${mx.host}`} style={mono}>
                {mx.priority} {mx.host}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section aria-label={tr('domains.sending')} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <strong style={{ fontSize: 13 }}>{tr('domains.sending')}</strong>
          <Status t={t} ready={check.sending.ready} />
        </div>
        <p style={s.muted}>{check.sending.ready ? tr('domains.note_sending_ready') : tr('domains.note_sending_missing')}</p>
        <ul style={{ margin: 0, paddingLeft: 18, color: t.text2 }}>
          {check.sending.records.map((record) => (
            <li key={`${record.type}-${record.name}`} style={mono}>
              {record.found
                ? tr('domains.record_found', { type: record.type, name: record.name })
                : tr('domains.record_missing', { type: record.type, name: record.name })}
            </li>
          ))}
        </ul>
      </section>
      <p style={s.muted}>{tr('domains.checked_at', { when: fmt.dateTime(check.checked_at) })}</p>
    </div>
  );
};

const DomainCard: React.FC<{ t: ThemeTokens; domain: AdminDomain; onRemove: () => void; removing: boolean }> = ({
  t,
  domain,
  onRemove,
  removing
}) => {
  const tr = useT();
  const s = adminStyles(t);
  const check = useCheckDomain();
  const [guide, setGuide] = React.useState(false);
  const panelId = React.useId();
  return (
    <li style={{ ...s.card, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px 12px', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 180px', minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 600, overflowWrap: 'anywhere' }}>{domain.name}</div>
          <div style={s.muted}>{tr('domains.addresses_count', { count: domain.addresses_count })}</div>
        </div>
        <button
          type="button"
          disabled={check.isPending}
          onClick={() => check.mutate(domain.id)}
          style={{ ...s.button, cursor: check.isPending ? 'progress' : 'pointer' }}
        >
          {check.isPending ? <Loader2 size={16} className="nm-spin" aria-hidden="true" /> : null}
          {check.isPending ? tr('admin.checking') : tr('admin.check_dns')}
        </button>
        <button
          type="button"
          disabled={removing}
          onClick={onRemove}
          style={{ ...s.dangerButton, cursor: removing ? 'progress' : 'pointer' }}
        >
          {tr('common.remove')}
        </button>
      </div>
      {check.isError ? (
        <p role="alert" style={{ ...s.muted, color: s.danger }}>
          {adminErrorText(check.error)}
        </p>
      ) : null}
      {check.data === undefined ? null : <DnsResult t={t} check={check.data} />}
      <div>
        <button
          type="button"
          aria-expanded={guide}
          aria-controls={panelId}
          onClick={() => setGuide((on) => !on)}
          style={{ ...s.button, height: 34, padding: '0 10px', border: 0, background: 'transparent', color: t.link }}
        >
          <ChevronDown
            size={16}
            aria-hidden="true"
            style={{ transform: guide ? 'rotate(180deg)' : 'none', transition: 'transform 120ms ease' }}
          />
          {guide ? tr('domains.hide_steps') : tr('domains.show_steps')}
        </button>
        {guide ? (
          <div id={panelId} style={{ marginTop: 8 }}>
            <DomainGuide t={t} domain={domain.name} />
          </div>
        ) : null}
      </div>
    </li>
  );
};

export const DomainsPanel: React.FC<{ t: ThemeTokens }> = ({ t }) => {
  const tr = useT();
  const s = adminStyles(t);
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
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <p role="alert" style={{ ...s.muted, color: s.danger }}>
          {adminErrorText(domains.error)}
        </p>
        <button
          type="button"
          onClick={() => {
            void domains.refetch();
          }}
          style={s.button}
        >
          {tr('common.retry')}
        </button>
      </div>
    );
  } else if (domains.data === undefined) {
    list = <Loading t={t} label={tr('domains.loading')} />;
  } else if (domains.data.length === 0) {
    list = <p style={s.muted}>{tr('domains.empty')}</p>;
  } else {
    list = (
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {domains.data.map((domain) => (
          <DomainCard key={domain.id} t={t} domain={domain} removing={removeAction.busy} onRemove={() => setRemoveTarget(domain)} />
        ))}
      </ul>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <form
        noValidate
        onSubmit={(event) => {
          void submit(event);
        }}
        style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-start' }}
      >
        <div style={{ flex: '1 1 240px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label htmlFor="domain-new" style={s.label}>
            {tr('domains.add_a_domain')}
          </label>
          <input
            id="domain-new"
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
            style={s.input}
          />
          {problem === null ? null : (
            <p id="domain-new-error" role="alert" style={{ ...s.muted, color: s.danger }}>
              {problem}
            </p>
          )}
        </div>
        <button
          type="submit"
          disabled={addAction.busy}
          style={{ ...s.primary, marginTop: 23, cursor: addAction.busy ? 'progress' : 'pointer' }}
        >
          {addAction.busy ? <Loader2 size={16} className="nm-spin" aria-hidden="true" /> : null}
          {tr('domains.add_domain')}
        </button>
      </form>
      {addAction.error === null ? null : (
        <p role="alert" style={{ ...s.muted, color: s.danger }}>
          {addAction.error}
        </p>
      )}
      <p style={s.muted}>
        {tRich('domains.add_note', {
          check: (
            <Badge t={t} tone="neutral">
              {tr('admin.check_dns')}
            </Badge>
          )
        })}
      </p>
      {removeAction.error === null ? null : (
        <p role="alert" style={{ ...s.muted, color: s.danger }}>
          {removeAction.error}
        </p>
      )}
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
