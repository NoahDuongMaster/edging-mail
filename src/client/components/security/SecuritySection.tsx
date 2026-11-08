import React from 'react';
import type { ThemeTokens } from '../../theme';
import { useSession } from '../../lib/auth';
import type { SessionUser } from '../../lib/auth';
import { useT } from '../../lib/i18n';
import { AuthButton } from '../auth/authUi';
import { ChangePasswordView } from './ChangePasswordView';
import { RecoveryKeyView } from './RecoveryKeyView';
import { TwoFactorView } from './TwoFactorView';
import { cardStyle, mutedStyle } from './securityUi';

type View = 'password' | 'key_test' | 'key_new' | 'two_factor_on' | 'two_factor_codes' | 'two_factor_off';

interface RowProps {
  t: ThemeTokens;
  id: string;
  label: string;
  /** Plain lines under the label. */
  hints?: readonly string[];
  first?: boolean;
  children?: React.ReactNode;
}

const NO_HINTS: readonly string[] = [];

/** One line of the card: what it is on the left, what can be done on the right (under it on a narrow screen). */
const Row: React.FC<RowProps> = ({ t, id, label, hints = NO_HINTS, first = false, children }) => (
  <div
    role="group"
    aria-labelledby={`${id}-label`}
    style={{
      display: 'flex',
      flexWrap: 'wrap',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 8,
      padding: '12px 0',
      borderTop: first ? 0 : `1px solid ${t.divider}`
    }}
  >
    <div style={{ flex: '1 1 220px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
      <div id={`${id}-label`} style={{ fontSize: 14, fontWeight: 500 }}>
        {label}
      </div>
      {hints.map((hint) => (
        <p key={hint} style={mutedStyle(t)}>
          {hint}
        </p>
      ))}
    </div>
    {children === undefined ? null : <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>{children}</div>}
  </div>
);

interface RowsProps {
  t: ThemeTokens;
  user: SessionUser;
  open: (view: View) => void;
}

const Rows: React.FC<RowsProps> = ({ t, user, open }) => {
  const tr = useT();
  // Only a member of an organisation that does not require it can turn it off: the same rule the Worker applies.
  const canTurnOff = user.role !== 'admin' && !user.require_2fa;
  const reason = user.role === 'admin' ? tr('security.cannot_turn_off_admin') : tr('security.cannot_turn_off_required');
  return (
    <div>
      <Row t={t} id="security-password" label={tr('term.password')} first>
        <AuthButton
          t={t}
          type="button"
          quiet
          label={tr('security.change_password')}
          onClick={() => {
            open('password');
          }}
        />
      </Row>
      <Row t={t} id="security-key" label={tr('term.recovery_key')} hints={[tr('security.recovery_hint')]}>
        <AuthButton
          t={t}
          type="button"
          quiet
          label={tr('security.test_key')}
          onClick={() => {
            open('key_test');
          }}
        />
        <AuthButton
          t={t}
          type="button"
          quiet
          label={tr('security.new_key')}
          onClick={() => {
            open('key_new');
          }}
        />
      </Row>
      {user.totp_enabled ? (
        <Row
          t={t}
          id="security-two-factor"
          label={tr('term.two_factor')}
          hints={canTurnOff ? [tr('security.status_on')] : [tr('security.status_on'), reason]}
        >
          <AuthButton
            t={t}
            type="button"
            quiet
            label={tr('security.new_codes')}
            onClick={() => {
              open('two_factor_codes');
            }}
          />
          {canTurnOff ? (
            <AuthButton
              t={t}
              type="button"
              quiet
              label={tr('security.turn_off')}
              onClick={() => {
                open('two_factor_off');
              }}
            />
          ) : null}
        </Row>
      ) : (
        <Row t={t} id="security-two-factor" label={tr('term.two_factor')} hints={[tr('security.status_off')]}>
          <AuthButton
            t={t}
            type="button"
            quiet
            label={tr('security.turn_on')}
            onClick={() => {
              open('two_factor_on');
            }}
          />
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
 */
export const SecuritySection: React.FC<{ t: ThemeTokens }> = ({ t }) => {
  const tr = useT();
  const session = useSession();
  const user = session.data?.user;
  const [view, setView] = React.useState<View | null>(null);
  const heading = React.useRef<HTMLHeadingElement>(null);
  const shown = React.useRef<View | null>(null);

  // The body of the card changes under the person: the heading takes the focus so a keyboard or a screen reader starts at the top of it.
  React.useEffect(() => {
    if (shown.current !== view) {
      shown.current = view;
      heading.current?.focus();
    }
  }, [view]);

  if (user === undefined) {
    return null;
  }
  return (
    <section aria-labelledby="security-title" style={cardStyle(t)}>
      <h3 id="security-title" ref={heading} tabIndex={-1} style={{ margin: 0, fontWeight: 600, fontSize: 13, outline: 'none' }}>
        {tr('security.title')}
      </h3>
      {view === null ? <Rows t={t} user={user} open={setView} /> : renderView(view, t, user, () => setView(null))}
    </section>
  );
};
