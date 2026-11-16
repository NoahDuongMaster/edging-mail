import React from 'react';
import { CircleCheck } from 'lucide-react';
import type { AdminUser } from '../../lib/admin/types';
import { usePatchUser } from '../../lib/admin/users';
import { announce } from '../../lib/announce';
import { fmt, useT } from '../../lib/i18n';
import { avatarHue } from '../../theme';
import { Avatar, Button, TextField } from '../../ui';
import { PersonRole, PersonStatus, PersonTwoFactor } from './adminUi';

/** The name of a person as the console shows it: their display name, or their address when they have none. */
export const personName = (user: AdminUser): string => (user.display_name === '' ? user.email : user.display_name);

/**
 * The top of a person's dialog: their initials, their address, their role, status and two-factor sign-in as words, and when they last
 * signed in (the date and time, which the People table only gives as "3 hours ago") or, for an account still on its temporary password,
 * until when it works; a scheduled reset of their two-factor sign-in under it.
 */
export const PersonSummary: React.FC<{ user: AdminUser; isSelf: boolean }> = ({ user, isSelf }) => {
  const tr = useT();
  let meta: string;
  if (user.last_login_at !== null) {
    meta = tr('users.last_sign_in', { when: fmt.dateTime(user.last_login_at) });
  } else if (user.temp_password_expires_at === null) {
    meta = tr('users.not_signed_in_yet');
  } else {
    meta = tr('users.temp_expires', { when: fmt.dateTime(user.temp_password_expires_at) });
  }
  return (
    <div className="ad-summary">
      <Avatar name={personName(user)} size={48} hue={user.status === 'disabled' ? undefined : avatarHue(user.email)} />
      <div className="ad-summary-text">
        <p className="ad-summary-address ad-wrap">{user.email}</p>
        <div className="ad-badges">
          <PersonRole user={user} />
          <PersonStatus user={user} />
          <PersonTwoFactor user={user} />
          {isSelf ? <span className="ad-muted">{tr('users.this_is_you')}</span> : null}
        </div>
        <p className="ad-muted">{meta}</p>
        {user.two_factor_reset_due_at === null ? null : (
          <p className="ad-muted">{tr('users.reset_scheduled', { due: fmt.dateTime(user.two_factor_reset_due_at) })}</p>
        )}
      </div>
    </div>
  );
};

interface NameFormProps {
  user: AdminUser;
  /** A request of the dialog is running: Save waits for it. */
  busy: boolean;
  /** The dialog's runner (busy flag, step-up, errors under the actions). */
  run: (change: () => Promise<unknown>) => Promise<void>;
}

/** The display name of a person, with its own Save. "Saved" shows under it once the new name is stored (and is said); typing again takes it away. */
export const NameForm: React.FC<NameFormProps> = ({ user, busy, run }) => {
  const tr = useT();
  const patch = usePatchUser();
  const [name, setName] = React.useState(user.display_name);
  const [saved, setSaved] = React.useState(false);
  const changed = name.trim() !== user.display_name;

  const save = (event: React.SyntheticEvent) => {
    event.preventDefault();
    if (changed && !busy) {
      void run(async () => {
        await patch.mutateAsync({ id: user.id, patch: { display_name: name.trim() } });
        setSaved(true);
        announce(tr('settings.saved'));
      });
    }
  };

  return (
    <form onSubmit={save} className="ad-dsec" aria-labelledby="user-profile">
      <h3 id="user-profile" className="ad-dsec-title">
        {tr('users.profile_heading')}
      </h3>
      <div className="ad-card ad-inline">
        <TextField
          id="user-name"
          label={tr('term.display_name')}
          maxLength={100}
          autoComplete="off"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setSaved(false);
          }}
        />
        <Button type="submit" disabled={busy}>
          {tr('users.save_name')}
        </Button>
      </div>
      {saved ? (
        <p className="ad-feedback">
          <CircleCheck size={16} aria-hidden="true" />
          {tr('settings.saved')}
        </p>
      ) : null}
    </form>
  );
};
