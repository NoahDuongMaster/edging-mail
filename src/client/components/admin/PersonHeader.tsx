import React from 'react';
import { CircleCheck } from 'lucide-react';
import type { AdminUser } from '../../lib/admin/types';
import { usePatchUser } from '../../lib/admin/users';
import { announce } from '../../lib/announce';
import { fmt, useT } from '../../lib/i18n';
import { avatarHue } from '../../theme';
import { Avatar, Button, InfoTip, TextField } from '../../ui';
import { PersonRole, PersonStatus, PersonTwoFactor, tipLines } from './adminUi';

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
    <div className="adm-summary">
      <Avatar name={personName(user)} size={48} hue={user.status === 'disabled' ? undefined : avatarHue(user.email)} />
      <div className="adm-summary-text">
        <p className="adm-summary-address adm-wrap">{user.email}</p>
        <div className="adm-badges">
          <PersonRole user={user} />
          <PersonStatus user={user} />
          <PersonTwoFactor user={user} />
          {isSelf ? <span className="adm-muted">{tr('users.this_is_you')}</span> : null}
        </div>
        <p className="adm-muted">{meta}</p>
        {user.two_factor_reset_due_at === null ? null : (
          <p className="adm-muted">{tr('users.reset_scheduled', { due: fmt.dateTime(user.two_factor_reset_due_at) })}</p>
        )}
      </div>
    </div>
  );
};

/**
 * The title of the account's actions in a person's dialog, with one InfoTip after it that says what each action shown does, after the
 * button's name (DESIGN-v4m R1: the lines beside the buttons are gone from the screen; each button keeps its line as its description).
 */
export const AccountHeading: React.FC<{ id: string; user: AdminUser; isSelf: boolean }> = ({ id, user, isSelf }) => {
  const tr = useT();
  const member = user.role === 'member';
  const lines: (readonly [string, string])[] = [
    member ? [tr('users.make_admin'), tr('users.make_admin_desc')] : [tr('users.make_member'), tr('users.make_member_desc')]
  ];
  if (!isSelf) {
    const active = user.status === 'active';
    lines.push(active ? [tr('admin.disable'), tr('users.disable_desc')] : [tr('admin.enable'), tr('users.enable_desc')]);
    if (user.two_factor) {
      lines.push([tr('users.reset_two_factor'), tr('users.reset_two_factor_desc')]);
    }
    if (user.never_signed_in) {
      lines.push([tr('users.reissue_temp_password'), tr('users.reissue_desc')]);
    }
  }
  return (
    <div className="ui-tip-row">
      <h3 id={id} className="adm-dsec-title">
        {tr('term.account')}
      </h3>
      <InfoTip label={tr('term.account')}>{tipLines(lines)}</InfoTip>
    </div>
  );
};

/**
 * One action of the account: the button, described by the line on what follows from it (`id`). The line is for screen readers only (the
 * section's InfoTip says it for every action, DESIGN-v4m R1) unless `shown`: why the button is off, needed where it is pressed.
 */
export const ActionLine: React.FC<{ id: string; text: string; shown?: boolean; children: React.ReactNode }> = ({
  id,
  text,
  shown,
  children
}) => (
  <div className="adm-action">
    <p id={id} className={shown === true ? 'adm-muted' : 'ui-visually-hidden'}>
      {text}
    </p>
    {children}
  </div>
);

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
    <form onSubmit={save} className="adm-dsec" aria-labelledby="user-profile">
      <h3 id="user-profile" className="adm-dsec-title">
        {tr('users.profile_heading')}
      </h3>
      <div className="adm-card adm-inline">
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
        <p className="adm-feedback">
          <CircleCheck size={16} aria-hidden="true" />
          {tr('settings.saved')}
        </p>
      ) : null}
    </form>
  );
};
