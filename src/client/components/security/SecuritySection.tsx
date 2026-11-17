import React from 'react';
import { CircleAlert, History, KeyRound, ListOrdered, Lock, LockKeyhole, MonitorSmartphone, ShieldCheck } from 'lucide-react';
import type { ThemeTokens } from '../../theme';
import { describeDevice, describeKind, formatWhen, useAccountActivity } from '../../lib/activity';
import { useSession } from '../../lib/auth';
import type { SessionUser } from '../../lib/auth';
import { useT } from '../../lib/i18n';
import { bannerRows, useCancelLockedDelete, useLockedMail, type LockedMail } from '../../lib/lockedMail';
import { Button } from '../../ui';
import { AccountActivity } from '../AccountActivity';
import { SettingsPage } from '../settings/SettingsPage';
import { ChangePasswordView } from './ChangePasswordView';
import { LockedMailDialog } from './LockedMailDialog';
import { OtherDevicesView } from './OtherDevicesView';
import { RecoveryKeyView } from './RecoveryKeyView';
import { keyTestedAt } from './keyTested';
import { StatusList, StatusRow, StatusWord, ViewFrame } from './securityUi';
import { TwoFactorView } from './TwoFactorView';
import '../settings/settings.css';

type View = 'password' | 'devices' | 'key_test' | 'key_new' | 'two_factor_on' | 'two_factor_codes' | 'two_factor_off' | 'activity';

/** Which way the content moved last: into a view (forward) or back to the cards. Null until the first move (no motion on arrival). */
type Direction = 'forward' | 'back' | null;

interface CardsProps {
  user: SessionUser;
  open: (view: View) => void;
  onDeleteLocked: (mail: LockedMail) => void;
}

/** The events after which the account has a new recovery key: its first sign-in (the key is made then), a replacement, a reset with it. */
const KEY_EVENTS = new Set(['first_sign_in', 'recovery_key_replaced', 'password_recovered', 'break_glass']);

interface ActivitySummary {
  lines: string[];
  notices: number;
  /** When the current recovery key was made, from the latest key event among the loaded activity (null when none is in it). */
  keySince: number | null;
}

/** The account activity in one line (the latest event and when, or what is still loading), and what it tells about the recovery key. */
function useActivitySummary(): ActivitySummary {
  const tr = useT();
  const query = useAccountActivity();
  if (query.isError) {
    return { lines: [tr('account.signins_load_failed')], notices: 0, keySince: null };
  }
  if (query.data === undefined) {
    return { lines: [tr('common.loading')], notices: 0, keySince: null };
  }
  const latest = query.data.activity.at(0);
  const keyEvent = query.data.activity.find((row) => row.ok && KEY_EVENTS.has(row.kind));
  return {
    // The latest event, when, and from which browser and address: what tells the person whether it was them.
    lines:
      latest === undefined
        ? [tr('account.signins_empty')]
        : [
            tr('account.latest', { event: describeKind(latest.kind, latest.ok), when: formatWhen(latest.at) }),
            describeDevice(latest.user_agent, latest.ip)
          ],
    notices: query.data.notices?.length ?? 0,
    keySince: keyEvent?.at ?? null
  };
}

/** Old mail under a key that was replaced: one row per key, with Delete, or the planned date and Cancel. Nothing when there is none. */
const LockedRows: React.FC<{ onDelete: (mail: LockedMail) => void }> = ({ onDelete }) => {
  const tr = useT();
  const mail = useLockedMail().data;
  const cancel = useCancelLockedDelete();
  if (mail === undefined) {
    return null;
  }
  // Every key is listed here, also one this tab chose to keep in the mailbox banner: the person came to Security to deal with it.
  return (
    <>
      {bannerRows(mail, [], () => false).map((row) => (
        <StatusRow
          key={row.mail.keyId}
          id={`security-locked-${row.mail.keyId}`}
          icon={Lock}
          tone="warning"
          title={tr('locked.card_title')}
          lines={[
            row.state === 'ask'
              ? tr('locked.banner', { count: row.mail.locked })
              : tr('locked.pending', { count: row.mail.locked, date: formatWhen(row.until) })
          ]}
        >
          {row.state === 'ask' ? (
            <Button size="sm" data-locked-delete onClick={() => onDelete(row.mail)}>
              {tr('locked.delete')}
            </Button>
          ) : (
            <Button size="sm" data-locked-cancel disabled={cancel.isPending} onClick={() => cancel.mutate(row.mail.keyId)}>
              {tr('locked.cancel')}
            </Button>
          )}
        </StatusRow>
      ))}
      {cancel.isError ? (
        <p role="alert" className="st-feedback st-status-error" data-tone="danger">
          <CircleAlert size={16} aria-hidden="true" />
          {cancel.error.message}
        </p>
      ) : null}
    </>
  );
};

/**
 * The overview: a status card per thing (v3), each with an icon tile in the tone of its state, the state in a word where the app knows it
 * and one action (two for the recovery key: test it, or replace it). The recovery key's card says since when the current key exists (from
 * the account activity) and when it was last tested in this browser; the server keeps no count of the recovery codes left, so their card
 * has no number.
 */
const Cards: React.FC<CardsProps> = ({ user, open, onDeleteLocked }) => {
  const tr = useT();
  const activity = useActivitySummary();
  // Only a member of an organisation that does not require it can turn it off: the same rule the Worker applies.
  const canTurnOff = user.role !== 'admin' && !user.require_2fa;
  const reason = user.role === 'admin' ? tr('security.cannot_turn_off_admin') : tr('security.cannot_turn_off_required');
  const on = user.totp_enabled;
  const tested = keyTestedAt(user.id);
  const keyFacts = [
    ...(activity.keySince === null ? [] : [tr('security.key_since', { date: formatWhen(activity.keySince) })]),
    ...(tested === null ? [] : [tr('security.key_tested_here', { date: formatWhen(tested) })])
  ];
  return (
    <StatusList>
      <StatusRow
        id="security-two-factor"
        icon={ShieldCheck}
        tone={on ? 'success' : 'warning'}
        title={tr('term.two_factor')}
        status={
          on ? (
            <StatusWord tone="success">{tr('security.badge_on')}</StatusWord>
          ) : (
            <StatusWord tone="warning">{tr('security.badge_off')}</StatusWord>
          )
        }
        lines={
          on ? (canTurnOff ? [tr('security.two_factor_on')] : [tr('security.two_factor_on'), reason]) : [tr('security.two_factor_off')]
        }
      >
        {on ? (
          canTurnOff ? (
            <Button
              size="sm"
              data-view="two_factor_off"
              onClick={() => {
                open('two_factor_off');
              }}
            >
              {tr('security.turn_off')}
            </Button>
          ) : undefined
        ) : (
          <Button
            size="sm"
            variant="primary"
            data-view="two_factor_on"
            onClick={() => {
              open('two_factor_on');
            }}
          >
            {tr('security.turn_on')}
          </Button>
        )}
      </StatusRow>
      <StatusRow
        id="security-key"
        icon={KeyRound}
        tone={user.has_keys ? 'success' : 'neutral'}
        title={tr('term.recovery_key')}
        status={user.has_keys ? <StatusWord tone="success">{tr('security.badge_saved')}</StatusWord> : undefined}
        lines={[tr('security.recovery_hint')]}
        facts={keyFacts}
      >
        <Button
          size="sm"
          data-view="key_test"
          onClick={() => {
            open('key_test');
          }}
          aria-describedby="security-key-label"
        >
          {tr('security.key_test_action')}
        </Button>
        <Button
          size="sm"
          data-view="key_new"
          onClick={() => {
            open('key_new');
          }}
          aria-describedby="security-key-label"
        >
          {tr('security.key_new_action')}
        </Button>
      </StatusRow>
      {on ? (
        <StatusRow id="security-codes" icon={ListOrdered} title={tr('term.recovery_codes')} lines={[tr('security.codes_hint')]}>
          <Button
            size="sm"
            data-view="two_factor_codes"
            onClick={() => {
              open('two_factor_codes');
            }}
            aria-describedby="security-codes-label"
          >
            {tr('security.codes_action')}
          </Button>
        </StatusRow>
      ) : null}
      <StatusRow id="security-password" icon={LockKeyhole} title={tr('term.password')} lines={[tr('security.password_hint')]}>
        <Button
          size="sm"
          data-view="password"
          onClick={() => {
            open('password');
          }}
        >
          {tr('security.change_password')}
        </Button>
      </StatusRow>
      <StatusRow id="security-devices" icon={MonitorSmartphone} title={tr('security.devices_title')} lines={[tr('security.devices_hint')]}>
        <Button
          size="sm"
          data-view="devices"
          onClick={() => {
            open('devices');
          }}
        >
          {tr('security.devices_action')}
        </Button>
      </StatusRow>
      <StatusRow
        id="security-activity"
        icon={History}
        tone={activity.notices > 0 ? 'warning' : 'neutral'}
        title={tr('account.activity_title')}
        status={
          activity.notices > 0 ? (
            <StatusWord tone="warning">{tr('account.notices_count', { count: activity.notices })}</StatusWord>
          ) : undefined
        }
        lines={[]}
        facts={activity.lines}
      >
        <Button
          size="sm"
          data-view="activity"
          onClick={() => {
            open('activity');
          }}
          aria-describedby="security-activity-label"
        >
          {tr('account.review')}
        </Button>
      </StatusRow>
      <LockedRows onDelete={onDeleteLocked} />
    </StatusList>
  );
};

function renderView(view: View, t: ThemeTokens, user: SessionUser, close: () => void, activityTitle: string): React.ReactNode {
  switch (view) {
    case 'password': {
      return <ChangePasswordView t={t} user={user} onBack={close} />;
    }
    case 'devices': {
      return <OtherDevicesView t={t} user={user} onBack={close} />;
    }
    case 'key_test': {
      return <RecoveryKeyView t={t} user={user} mode="test" onBack={close} />;
    }
    case 'key_new': {
      return <RecoveryKeyView t={t} user={user} mode="new" onBack={close} />;
    }
    case 'two_factor_on': {
      return <TwoFactorView t={t} user={user} mode="on" onBack={close} />;
    }
    case 'two_factor_codes': {
      return <TwoFactorView t={t} user={user} mode="codes" onBack={close} />;
    }
    case 'two_factor_off': {
      return <TwoFactorView t={t} user={user} mode="off" onBack={close} />;
    }
    case 'activity': {
      return (
        <ViewFrame t={t} title={activityTitle} onBack={close}>
          <AccountActivity t={t} />
        </ViewFrame>
      );
    }
  }
}

/**
 * Settings > Security: two-factor sign-in, the recovery key and codes, the password, the account activity and locked old mail, as status
 * cards with one action each. An action swaps the cards for its view (only one at a time; it slides in from the side it goes to, and back);
 * going back unmounts it, and with it everything it held (a typed password, an opened key, a new recovery key).
 */
export const SecuritySection: React.FC<{ t: ThemeTokens }> = ({ t }) => {
  const tr = useT();
  const session = useSession();
  const user = session.data?.user;
  const [view, setView] = React.useState<View | null>(null);
  const [direction, setDirection] = React.useState<Direction>(null);
  const [deleting, setDeleting] = React.useState<LockedMail | null>(null);
  const heading = React.useRef<HTMLHeadingElement>(null);
  const section = React.useRef<HTMLDivElement>(null);
  const shown = React.useRef<View | null>(null);

  // The body of the section changes under the person. Into a view: the heading takes the focus, so a keyboard or a screen reader starts at
  // the top of it. Back to the cards: the focus returns to the button that opened the view, or to the heading when the card no longer
  // offers it (after two-factor sign-in was turned on or off, its card has other buttons).
  React.useEffect(() => {
    const before = shown.current;
    if (before !== view) {
      shown.current = view;
      const back = view === null && before !== null;
      const opener = back ? section.current?.querySelector<HTMLElement>(`[data-view="${CSS.escape(before)}"]`) : null;
      (opener ?? heading.current)?.focus();
    }
  }, [view]);

  if (user === undefined) {
    return null;
  }
  const open = (next: View) => {
    setDirection('forward');
    setView(next);
  };
  const close = () => {
    setDirection('back');
    setView(null);
  };
  return (
    <SettingsPage titleId="security-title" titleRef={heading} title={tr('security.title')} description={tr('security.description')}>
      <div ref={section} key={view ?? 'cards'} className="st-push" data-direction={direction ?? undefined}>
        {view === null ? (
          <Cards user={user} open={open} onDeleteLocked={setDeleting} />
        ) : (
          renderView(view, t, user, close, tr('account.activity_title'))
        )}
      </div>
      {deleting === null ? null : <LockedMailDialog t={t} user={user} mail={deleting} onClose={() => setDeleting(null)} />}
    </SettingsPage>
  );
};
