import React from 'react';
import type { ThemeTokens } from '../../theme';
import { useSession } from '../../lib/auth';
import type { SessionUser } from '../../lib/auth';
import { useT } from '../../lib/i18n';
import { Button } from '../../ui';
import { ChangePasswordView } from './ChangePasswordView';
import { RecoveryKeyView } from './RecoveryKeyView';
import { TwoFactorView } from './TwoFactorView';
import '../settings/settings.css';

type View = 'password' | 'key_test' | 'key_new' | 'two_factor_on' | 'two_factor_codes' | 'two_factor_off';

interface RowProps {
  id: string;
  label: string;
  /** Plain lines under the label. */
  hints?: readonly string[];
  children?: React.ReactNode;
}

const NO_HINTS: readonly string[] = [];

/** One setting: what it is on the left, what can be done on the right (under it on a narrow screen). Rows are split by hairlines. */
const Row: React.FC<RowProps> = ({ id, label, hints = NO_HINTS, children }) => (
  <div role="group" aria-labelledby={`${id}-label`} className="st-setting">
    <div className="st-setting-text">
      <div id={`${id}-label`} className="st-setting-label">
        {label}
      </div>
      {hints.map((hint) => (
        <p key={hint} className="st-muted">
          {hint}
        </p>
      ))}
    </div>
    {children === undefined ? null : <div className="st-setting-actions">{children}</div>}
  </div>
);

interface RowsProps {
  user: SessionUser;
  open: (view: View) => void;
}

const Rows: React.FC<RowsProps> = ({ user, open }) => {
  const tr = useT();
  // Only a member of an organisation that does not require it can turn it off: the same rule the Worker applies.
  const canTurnOff = user.role !== 'admin' && !user.require_2fa;
  const reason = user.role === 'admin' ? tr('security.cannot_turn_off_admin') : tr('security.cannot_turn_off_required');
  return (
    <div>
      <Row id="security-password" label={tr('term.password')}>
        <Button
          size="sm"
          data-view="password"
          onClick={() => {
            open('password');
          }}
        >
          {tr('security.change_password')}
        </Button>
      </Row>
      <Row id="security-key" label={tr('term.recovery_key')} hints={[tr('security.recovery_hint')]}>
        <Button
          size="sm"
          data-view="key_test"
          onClick={() => {
            open('key_test');
          }}
        >
          {tr('security.test_key')}
        </Button>
        <Button
          size="sm"
          data-view="key_new"
          onClick={() => {
            open('key_new');
          }}
        >
          {tr('security.new_key')}
        </Button>
      </Row>
      {user.totp_enabled ? (
        <Row
          id="security-two-factor"
          label={tr('term.two_factor')}
          hints={canTurnOff ? [tr('security.status_on')] : [tr('security.status_on'), reason]}
        >
          <Button
            size="sm"
            data-view="two_factor_codes"
            onClick={() => {
              open('two_factor_codes');
            }}
          >
            {tr('security.new_codes')}
          </Button>
          {canTurnOff ? (
            <Button
              size="sm"
              data-view="two_factor_off"
              onClick={() => {
                open('two_factor_off');
              }}
            >
              {tr('security.turn_off')}
            </Button>
          ) : null}
        </Row>
      ) : (
        <Row id="security-two-factor" label={tr('term.two_factor')} hints={[tr('security.status_off')]}>
          <Button
            size="sm"
            data-view="two_factor_on"
            onClick={() => {
              open('two_factor_on');
            }}
          >
            {tr('security.turn_on')}
          </Button>
        </Row>
      )}
    </div>
  );
};

function renderView(view: View, t: ThemeTokens, user: SessionUser, close: () => void): React.ReactNode {
  switch (view) {
    case 'password': {
      return <ChangePasswordView t={t} user={user} onBack={close} />;
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
  }
}

/**
 * Settings > Account > Security: the password, the recovery key and two-factor sign-in, as plain rows. A button swaps the rows for that action
 * (only one at a time); going back unmounts it, and with it everything it held (a typed password, an opened key, a new recovery key).
 * A section of the Account tab like the others (ui-section): its title is its own element because it takes the focus.
 */
export const SecuritySection: React.FC<{ t: ThemeTokens }> = ({ t }) => {
  const tr = useT();
  const session = useSession();
  const user = session.data?.user;
  const [view, setView] = React.useState<View | null>(null);
  const heading = React.useRef<HTMLHeadingElement>(null);
  const section = React.useRef<HTMLElement>(null);
  const shown = React.useRef<View | null>(null);

  // The body of the section changes under the person. Into a view: the heading takes the focus, so a keyboard or a screen reader starts at
  // the top of it. Back to the rows: the focus returns to the button that opened the view, or to the heading when the row no longer offers it
  // (after two-factor sign-in was turned on or off, its row has other buttons).
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
  return (
    <section ref={section} aria-labelledby="security-title" className="ui-section">
      <div className="ui-section-head">
        <div className="ui-section-heading">
          <h3 id="security-title" ref={heading} tabIndex={-1} className="ui-section-title st-focus-title">
            {tr('security.title')}
          </h3>
        </div>
      </div>
      {view === null ? <Rows user={user} open={setView} /> : renderView(view, t, user, () => setView(null))}
    </section>
  );
};
