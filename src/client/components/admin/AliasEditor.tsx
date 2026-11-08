import React from 'react';
import { X } from 'lucide-react';
import type { ThemeTokens } from '../../theme';
import { domainProblem, localPartProblem } from '../../lib/admin/address';
import type { AdminUser } from '../../lib/admin/types';
import { useAddAlias, useRemoveAlias } from '../../lib/admin/users';
import { useT, type TFunction } from '../../lib/i18n';
import { Button, IconButton, Table, TextField, VisuallyHidden } from '../../ui';
import { ErrorText } from './adminUi';
import { useAdminAction } from './useAdminAction';

/** What is wrong with a full alias address, or null. The domain must be one the deployment already has (the server says so if not). */
function aliasProblem(address: string, tr: TFunction): string | null {
  const parts = address.split('@');
  if (parts.length !== 2) {
    return tr('users.err_alias_incomplete');
  }
  return localPartProblem(parts[0]) ?? domainProblem(parts[1]);
}

/** The extra addresses that deliver to this person (mail to any of them lands in their mailbox; they still send from their own address). */
export const AliasEditor: React.FC<{ t: ThemeTokens; user: AdminUser }> = ({ user }) => {
  const tr = useT();
  const add = useAddAlias();
  const remove = useRemoveAlias();
  const action = useAdminAction();
  const [value, setValue] = React.useState('');
  const [touched, setTouched] = React.useState(false);
  const address = value.trim().toLowerCase();
  const problem = touched && address !== '' ? aliasProblem(address, tr) : null;

  const submit = async (event: React.SyntheticEvent) => {
    event.preventDefault();
    setTouched(true);
    if (action.busy || aliasProblem(address, tr) !== null) {
      return;
    }
    const done = await action.run(() => add.mutateAsync({ id: user.id, address }));
    if (done) {
      setValue('');
      setTouched(false);
    }
  };

  return (
    <section aria-labelledby="alias-heading" className="ad-dsec">
      <h3 id="alias-heading" className="ad-dsec-title">
        {tr('users.alias_heading')}
      </h3>
      <p className="ad-muted">{tr('users.alias_hint')}</p>
      {user.aliases.length === 0 ? (
        <p className="ad-muted">{tr('users.alias_none')}</p>
      ) : (
        <Table label={tr('users.alias_heading')} dense className="ad-table ad-table-aliases">
          <thead>
            <tr>
              <th scope="col">{tr('term.address')}</th>
              <th scope="col" className="ad-end">
                <VisuallyHidden>{tr('admin.col_actions')}</VisuallyHidden>
              </th>
            </tr>
          </thead>
          <tbody>
            {user.aliases.map((alias) => (
              <tr key={alias}>
                <td className="ad-cell-alias ad-wrap">{alias}</td>
                <td className="ad-cell-remove ad-end ad-shrink">
                  <IconButton
                    label={tr('users.alias_remove', { address: alias })}
                    size="sm"
                    disabled={action.busy}
                    onClick={() => {
                      void action.run(() => remove.mutateAsync({ id: user.id, address: alias }));
                    }}
                  >
                    <X size={16} aria-hidden="true" />
                  </IconButton>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <form
        noValidate
        onSubmit={(event) => {
          void submit(event);
        }}
        className="ad-field-group"
      >
        <div className="ad-inline">
          <TextField
            id="alias-new"
            label={tr('users.alias_add_label')}
            type="text"
            inputMode="email"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            autoComplete="off"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onBlur={() => setTouched(true)}
            aria-invalid={problem !== null}
            aria-describedby={problem === null ? undefined : 'alias-new-error'}
            placeholder={tr('users.alias_placeholder')}
          />
          <Button type="submit" disabled={action.busy} loading={action.busy}>
            {tr('common.add')}
          </Button>
        </div>
        {problem === null ? null : <ErrorText id="alias-new-error">{problem}</ErrorText>}
      </form>
      {action.error === null ? null : <ErrorText>{action.error}</ErrorText>}
    </section>
  );
};
