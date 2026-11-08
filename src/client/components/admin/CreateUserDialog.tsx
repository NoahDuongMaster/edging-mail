import React from 'react';
import { Loader2 } from 'lucide-react';
import type { ThemeTokens } from '../../theme';
import { deriveAccountAuth } from '../../lib/credentials';
import { useT } from '../../lib/i18n';
import { localPartProblem } from '../../lib/admin/address';
import { adminClaim } from '../../lib/admin/claims';
import { useAdminDomains } from '../../lib/admin/domains';
import { useCreateUser } from '../../lib/admin/users';
import type { Role } from '../../lib/admin/types';
import { generateTempPassword } from '../../lib/password/random';
import { Loading } from './TempPasswordDialog';
import { ModalFrame, adminStyles } from './adminUi';
import { useAdminAction } from './useAdminAction';

interface CreateUserDialogProps {
  t: ThemeTokens;
  onClose: () => void;
  /** The account exists. The temporary password is handed over here, once, and kept nowhere else. */
  onCreated: (account: { address: string; password: string }) => void;
  onGoToDomains: () => void;
}

export const CreateUserDialog: React.FC<CreateUserDialogProps> = ({ t, onClose, onCreated, onGoToDomains }) => {
  const tr = useT();
  const s = adminStyles(t);
  const domains = useAdminDomains();
  const create = useCreateUser();
  const action = useAdminAction();
  const [localPart, setLocalPart] = React.useState('');
  const [domain, setDomain] = React.useState('');
  const [displayName, setDisplayName] = React.useState('');
  const [role, setRole] = React.useState<Role>('member');
  const [touched, setTouched] = React.useState(false);

  const list = domains.data ?? [];
  const chosenDomain = domain === '' ? (list.at(0)?.name ?? '') : domain;
  const local = localPart.trim().toLowerCase();
  const problem = touched ? localPartProblem(local) : null;

  const submit = async (event: React.SyntheticEvent) => {
    event.preventDefault();
    setTouched(true);
    if (action.busy || localPartProblem(local) !== null || chosenDomain === '') {
      return;
    }
    const address = `${local}@${chosenDomain}`;
    // A new temporary password for every attempt: one that was never shown is never reused.
    const password = generateTempPassword();
    const created = await action.run(async () => {
      const { auth, kdf } = await deriveAccountAuth(address, password);
      await create.mutateAsync({ local_part: local, domain: chosenDomain, display_name: displayName.trim(), role, auth, kdf });
    });
    if (created) {
      onCreated({ address, password });
    }
  };

  let body: React.ReactNode;
  if (domains.isError) {
    body = (
      <p role="alert" style={{ ...s.muted, color: s.danger }}>
        {tr('users.create_domains_failed')}{' '}
        <button
          type="button"
          onClick={() => {
            void domains.refetch();
          }}
          style={{ ...s.button, height: 32, padding: '0 10px' }}
        >
          {tr('common.retry')}
        </button>
      </p>
    );
  } else if (domains.data === undefined) {
    body = <Loading t={t} label={tr('common.loading')} />;
  } else if (list.length === 0) {
    body = (
      <>
        <p style={{ margin: 0, fontSize: 13.5, lineHeight: '20px' }}>{tr('users.create_no_domain')}</p>
        <div>
          <button type="button" onClick={onGoToDomains} style={s.primary}>
            {tr('domains.add_a_domain')}
          </button>
        </div>
      </>
    );
  } else {
    body = (
      <form
        noValidate
        onSubmit={(event) => {
          void submit(event);
        }}
        style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label htmlFor="new-user-local" style={s.label}>
            {tr('term.address')}
          </label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <input
              id="new-user-local"
              data-autofocus
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              autoComplete="off"
              inputMode="email"
              value={localPart}
              onChange={(e) => setLocalPart(e.target.value)}
              onBlur={() => setTouched(true)}
              aria-invalid={problem !== null}
              aria-describedby={problem === null ? undefined : 'new-user-local-error'}
              style={{ ...s.input, flex: '1 1 140px', minWidth: 0, width: 'auto' }}
            />
            <span aria-hidden="true" style={{ color: t.text2 }}>
              @
            </span>
            {list.length === 1 ? (
              <span style={{ flex: '1 1 140px', minWidth: 0, overflowWrap: 'anywhere', fontSize: 15 }}>{list[0].name}</span>
            ) : (
              <select
                aria-label={tr('term.domain')}
                value={chosenDomain}
                onChange={(e) => setDomain(e.target.value)}
                style={{ ...s.input, flex: '1 1 140px', minWidth: 0, width: 'auto' }}
              >
                {list.map((item) => (
                  <option key={item.id} value={item.name}>
                    {item.name}
                  </option>
                ))}
              </select>
            )}
          </div>
          {problem === null ? null : (
            <p id="new-user-local-error" role="alert" style={{ ...s.muted, color: s.danger }}>
              {problem}
            </p>
          )}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label htmlFor="new-user-name" style={s.label}>
            {tr('term.display_name')}
          </label>
          <input
            id="new-user-name"
            autoComplete="off"
            maxLength={100}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            style={s.input}
          />
          <p style={s.muted}>{tr('users.create_name_hint')}</p>
        </div>
        <fieldset style={{ margin: 0, padding: 0, border: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <legend style={{ ...s.label, padding: 0, marginBottom: 6 }}>{tr('users.role')}</legend>
          {(['member', 'admin'] as const).map((value) => (
            <label
              key={value}
              className="nm-tap-h"
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', fontSize: 14 }}
            >
              <input type="radio" name="new-user-role" checked={role === value} onChange={() => setRole(value)} />
              {value === 'member' ? tr('term.member') : tr('term.admin')}
            </label>
          ))}
        </fieldset>
        {role === 'admin' ? <p style={s.muted}>{adminClaim().join(' ')}</p> : null}
        <p style={s.muted}>{tr('users.create_password_note')}</p>
        {action.error === null ? null : (
          <p role="alert" style={{ ...s.muted, color: s.danger }}>
            {action.error}
          </p>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" onClick={onClose} disabled={action.busy} style={s.button}>
            {tr('common.cancel')}
          </button>
          <button
            type="submit"
            disabled={action.busy}
            style={{ ...s.primary, cursor: action.busy ? 'progress' : 'pointer', opacity: action.busy ? 0.7 : 1 }}
          >
            {action.busy ? <Loader2 size={16} className="nm-spin" aria-hidden="true" /> : null}
            {action.busy ? tr('users.creating') : tr('users.create_account')}
          </button>
        </div>
      </form>
    );
  }

  return (
    <ModalFrame t={t} title={tr('users.new_account')} onClose={onClose} locked={action.busy}>
      {body}
    </ModalFrame>
  );
};
