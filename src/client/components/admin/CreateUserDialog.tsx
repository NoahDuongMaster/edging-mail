import React from 'react';
import type { ThemeTokens } from '../../theme';
import { deriveAccountAuth } from '../../lib/credentials';
import { useT } from '../../lib/i18n';
import { localPartProblem } from '../../lib/admin/address';
import { adminClaim } from '../../lib/admin/claims';
import { useAdminDomains } from '../../lib/admin/domains';
import { useCreateUser } from '../../lib/admin/users';
import type { Role } from '../../lib/admin/types';
import { generateTempPassword } from '../../lib/password/random';
import { Banner, Button, RadioGroup, Select, TextField } from '../../ui';
import { Loading } from './TempPasswordDialog';
import { ErrorText, ModalFrame } from './adminUi';
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
      <Banner
        tone="danger"
        action={
          <Button
            size="sm"
            onClick={() => {
              void domains.refetch();
            }}
          >
            {tr('common.retry')}
          </Button>
        }
      >
        {tr('users.create_domains_failed')}
      </Banner>
    );
  } else if (domains.data === undefined) {
    body = <Loading t={t} label={tr('common.loading')} />;
  } else if (list.length === 0) {
    body = (
      <>
        <p className="ad-text">{tr('users.create_no_domain')}</p>
        <div className="ad-dialog-foot">
          <Button variant="primary" onClick={onGoToDomains}>
            {tr('domains.add_a_domain')}
          </Button>
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
        className="ad-form"
      >
        <div className="ad-field-group">
          <div className="ad-address">
            <TextField
              id="new-user-local"
              label={tr('term.address')}
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
            />
            <span aria-hidden="true" className="ad-at">
              @
            </span>
            {list.length === 1 ? (
              <span className="ad-domain-name">{list[0].name}</span>
            ) : (
              <Select
                label={tr('term.domain')}
                hideLabel
                options={list.map((item) => ({ value: item.name, label: item.name }))}
                value={chosenDomain}
                onChange={setDomain}
              />
            )}
          </div>
          {problem === null ? null : <ErrorText id="new-user-local-error">{problem}</ErrorText>}
        </div>
        <TextField
          id="new-user-name"
          label={tr('term.display_name')}
          hint={tr('users.create_name_hint')}
          autoComplete="off"
          maxLength={100}
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
        />
        <RadioGroup
          label={tr('users.role')}
          name="new-user-role"
          options={[
            { value: 'member', label: tr('term.member') },
            { value: 'admin', label: tr('term.admin') }
          ]}
          value={role}
          onChange={(value) => setRole(value === 'admin' ? 'admin' : 'member')}
        />
        {role === 'admin' ? <p className="ad-muted">{adminClaim().join(' ')}</p> : null}
        <p className="ad-muted">{tr('users.create_password_note')}</p>
        {action.error === null ? null : <ErrorText>{action.error}</ErrorText>}
        <div className="ad-dialog-foot">
          <Button onClick={onClose} disabled={action.busy}>
            {tr('common.cancel')}
          </Button>
          <Button type="submit" variant="primary" disabled={action.busy} loading={action.busy}>
            {action.busy ? tr('users.creating') : tr('users.create_account')}
          </Button>
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
