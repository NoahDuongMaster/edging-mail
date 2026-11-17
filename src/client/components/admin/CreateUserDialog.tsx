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

/** The form of the dialog; its Create account is in the dialog's foot, outside it. */
const FORM_ID = 'new-user-form';

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
  // The dialog's buttons, in its foot (fixed at the bottom of a phone's sheet): Create account names the form it sends.
  let footer: React.ReactNode;
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
    body = <p className="adm-text">{tr('users.create_no_domain')}</p>;
    footer = (
      <Button variant="primary" onClick={onGoToDomains}>
        {tr('domains.add_a_domain')}
      </Button>
    );
  } else {
    body = (
      <form
        id={FORM_ID}
        noValidate
        onSubmit={(event) => {
          void submit(event);
        }}
        className="adm-form"
      >
        <div className="adm-field-group">
          <div className="adm-address">
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
            <span aria-hidden="true" className="adm-at">
              @
            </span>
            {list.length === 1 ? (
              <span className="adm-domain-name">{list[0].name}</span>
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
            // What an admin can and cannot do (crypto-design 15.1, word for word), in an InfoTip after the choice.
            { value: 'admin', label: tr('term.admin'), hint: adminClaim().join(' ') }
          ]}
          value={role}
          onChange={(value) => setRole(value === 'admin' ? 'admin' : 'member')}
        />
        <p className="adm-muted">{tr('users.create_password_note_short')}</p>
        {action.error === null ? null : <ErrorText>{action.error}</ErrorText>}
      </form>
    );
    footer = (
      <>
        <Button onClick={onClose} disabled={action.busy}>
          {tr('common.cancel')}
        </Button>
        <Button type="submit" form={FORM_ID} variant="primary" disabled={action.busy} loading={action.busy}>
          {action.busy ? tr('users.creating') : tr('users.create_account')}
        </Button>
      </>
    );
  }

  return (
    <ModalFrame t={t} title={tr('users.new_account')} onClose={onClose} locked={action.busy} footer={footer}>
      {body}
    </ModalFrame>
  );
};
