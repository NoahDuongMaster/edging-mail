import React from 'react';
import type { ThemeTokens } from '../../theme';
import type { Session, SessionUser } from '../../lib/auth';
import { fetchMyKeys } from '../../lib/crypto/unlock';
import { restoreKey, sweepKeys } from '../../lib/crypto/keyStore';
import { useUnlockedKey } from '../../lib/crypto/useUnlockedKey';
import { focusFirstTitle } from '../../lib/screenFocus';
import { BreakGlassScreen } from './BreakGlassScreen';
import { ForgotScreen } from './ForgotScreen';
import { FirstPasswordScreen, KeySetupScreen, TwoFactorGateScreen } from './GateScreens';
import { SetupScreen } from './SetupScreen';
import { SignInScreen } from './SignInScreen';
import { UnlockScreen } from './UnlockScreen';

type Restore = 'checking' | 'locked' | 'ready';

/**
 * At every start with a signed-in person who has keys: the stored key is used when it is recent and is the key the server holds now;
 * otherwise (or on a shared device) the unlock screen asks for the password. Nothing of the mailbox mounts before this has answered.
 */
function useKeyRestore(user: SessionUser | undefined, gateOpen: boolean): Restore {
  const unlocked = useUnlockedKey();
  const [checked, setChecked] = React.useState<string | null>(null);
  const userId = user?.id ?? null;
  const needs = userId !== null && user?.has_keys === true && !gateOpen && unlocked === null;
  const alreadyChecked = checked === userId;
  React.useEffect(() => {
    if (!needs || alreadyChecked) {
      return;
    }
    const run = { cancelled: false };
    void (async () => {
      try {
        const { keys } = await fetchMyKeys();
        if (keys !== null) {
          await restoreKey(userId, keys);
        }
      } catch {
        // The server could not be reached: the unlock screen takes over and asks for the password.
      }
      if (!run.cancelled) {
        setChecked(userId);
      }
    })();
    return () => {
      run.cancelled = true;
    };
  }, [needs, userId, alreadyChecked]);
  if (!needs) {
    return 'ready';
  }
  return alreadyChecked ? 'locked' : 'checking';
}

/** Before anyone is signed in: Setup on a fresh deployment, else sign-in, with the forgotten-password flow and break-glass one step away. */
const SignedOut: React.FC<{ t: ThemeTokens; session: Session }> = ({ t, session }) => {
  const [view, setView] = React.useState<'sign_in' | 'forgot' | 'break_glass'>('sign_in');
  if (session.setup_required === true) {
    return <SetupScreen t={t} session={session} />;
  }
  if (view === 'forgot') {
    return <ForgotScreen t={t} initialEmail="" onBack={() => setView('sign_in')} onBreakGlass={() => setView('break_glass')} />;
  }
  if (view === 'break_glass') {
    return <BreakGlassScreen t={t} onBack={() => setView('sign_in')} />;
  }
  return <SignInScreen t={t} onForgot={() => setView('forgot')} />;
};

interface AuthGateProps {
  t: ThemeTokens;
  session: Session;
  children: React.ReactNode;
}

/**
 * Everything between "the page opened" and "the mailbox": Setup on a fresh deployment, sign-in, the three gates of a first sign-in (password,
 * keys, two-factor) and the unlock of the key. `children` (the mailbox) mounts only when none of them is open.
 */
export const AuthGate: React.FC<AuthGateProps> = ({ t, session, children }) => {
  const user = session.user;
  const gate = session.gate ?? null;
  const restore = useKeyRestore(session.authenticated ? user : undefined, gate !== null);
  const userId = session.authenticated ? (user?.id ?? null) : null;

  // C-9: after sign-in, a gate or an unlock, the mailbox opens with the keyboard on its title, not on <body> (where the Tab key starts from the top
  // of the page). Only after the person met one of these screens: a page that opens straight into the mailbox keeps the browser's own start.
  const screenShown = !session.authenticated || gate !== null || restore === 'locked';
  const mailboxShown = session.authenticated && user !== undefined && gate === null && restore === 'ready';
  const metAScreen = React.useRef(false);
  React.useEffect(() => {
    if (screenShown) {
      metAScreen.current = true;
    } else if (mailboxShown && metAScreen.current) {
      metAScreen.current = false;
      focusFirstTitle();
    }
  }, [screenShown, mailboxShown]);

  // The stale-key sweeper: runs when the session becomes known and whenever the person changes, and deletes every stored key that is not
  // that person's (all of them when nobody is signed in) or is older than seven days.
  React.useEffect(() => {
    void sweepKeys(userId);
  }, [userId]);

  if (!session.authenticated) {
    return <SignedOut t={t} session={session} />;
  }
  if (user === undefined) {
    return null;
  }
  if (gate === 'password_change_required') {
    return <FirstPasswordScreen t={t} user={user} />;
  }
  if (gate === 'key_setup_required') {
    return <KeySetupScreen t={t} user={user} />;
  }
  if (gate === 'two_factor_enrollment_required') {
    return <TwoFactorGateScreen t={t} user={user} />;
  }
  if (restore === 'checking') {
    return <div style={{ height: '100%', background: t.bg }} />;
  }
  if (restore === 'locked') {
    return <UnlockScreen t={t} user={user} />;
  }
  return <>{children}</>;
};
