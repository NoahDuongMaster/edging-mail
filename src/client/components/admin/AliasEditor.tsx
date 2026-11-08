import React from 'react';
import { Loader2, X } from 'lucide-react';
import type { ThemeTokens } from '../../theme';
import { domainProblem, localPartProblem } from '../../lib/admin/address';
import type { AdminUser } from '../../lib/admin/types';
import { useAddAlias, useRemoveAlias } from '../../lib/admin/users';
import { useT, type TFunction } from '../../lib/i18n';
import { adminStyles } from './adminUi';
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
export const AliasEditor: React.FC<{ t: ThemeTokens; user: AdminUser }> = ({ t, user }) => {
  const tr = useT();
  const s = adminStyles(t);
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
    <section aria-labelledby="alias-heading" style={{ ...s.card, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <h3 id="alias-heading" style={s.h3}>
        {tr('users.alias_heading')}
      </h3>
      <p style={s.muted}>{tr('users.alias_hint')}</p>
      {user.aliases.length === 0 ? (
        <p style={s.muted}>{tr('users.alias_none')}</p>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {user.aliases.map((alias) => (
            <li key={alias} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
              <span style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>{alias}</span>
              <button
                type="button"
                className="nm-tap"
                disabled={action.busy}
                aria-label={tr('users.alias_remove', { address: alias })}
                onClick={() => {
                  void action.run(() => remove.mutateAsync({ id: user.id, address: alias }));
                }}
                style={{
                  width: 36,
                  height: 36,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  border: 0,
                  borderRadius: 10,
                  background: 'transparent',
                  color: t.text2,
                  cursor: action.busy ? 'progress' : 'pointer'
                }}
              >
                <X size={16} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <form
        noValidate
        onSubmit={(event) => {
          void submit(event);
        }}
        style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-start' }}
      >
        <div style={{ flex: '1 1 200px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label htmlFor="alias-new" style={s.label}>
            {tr('users.alias_add_label')}
          </label>
          <input
            id="alias-new"
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
            style={s.input}
          />
          {problem === null ? null : (
            <p id="alias-new-error" role="alert" style={{ ...s.muted, color: s.danger }}>
              {problem}
            </p>
          )}
        </div>
        <button type="submit" disabled={action.busy} style={{ ...s.button, marginTop: 23, cursor: action.busy ? 'progress' : 'pointer' }}>
          {action.busy ? <Loader2 size={16} className="nm-spin" aria-hidden="true" /> : null}
          {tr('common.add')}
        </button>
      </form>
      {action.error === null ? null : (
        <p role="alert" style={{ ...s.muted, color: s.danger }}>
          {action.error}
        </p>
      )}
    </section>
  );
};
