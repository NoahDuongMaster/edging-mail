import React from 'react';
import { getTokens } from '../theme';
import { signOutRequest } from '../lib/auth';
import { useDocumentTitle } from '../lib/documentTitle';
import { tr } from '../lib/i18n';
import { pushForSignOut } from '../lib/push';
import { Button, EmptyState } from '../ui';
import './auth/auth.css';

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  failed: boolean;
}

/**
 * The next step when Reload does not help (J4-25): sign out (the keys of this device are wiped, the session ends) and start again. It uses
 * the plain request, not the app's query cache, which may be what failed; the page reloads into the sign-in screen after it.
 */
const SignOutAgain: React.FC = () => {
  const [state, setState] = React.useState<'idle' | 'busy' | 'failed'>('idle');
  const signOut = async () => {
    setState('busy');
    try {
      await signOutRequest(pushForSignOut());
      window.location.reload();
    } catch {
      setState('failed');
    }
  };
  return (
    <div className="au-crash-more">
      <p className="au-note">{tr('crash.keeps_happening')}</p>
      <Button
        variant="ghost"
        size="lg"
        className="au-text-btn"
        disabled={state === 'busy'}
        onClick={() => {
          void signOut();
        }}
      >
        {tr('auth.sign_out')}
      </Button>
      {state === 'failed' ? (
        <p role="alert" className="ui-error au-error">
          {tr('fail.sign_out')}
        </p>
      ) : null}
    </div>
  );
};

/**
 * The crash screen: a status page like the ones before the mailbox (the landing's grid and glow round one centred card), with Edgar (112 px,
 * still: a moving mascot next to a failure reads as flippant), what happened, what to do, and Reload. App holds the theme state and just
 * crashed, so the stored choice is read directly, and the page's own colours are real values, not variables: this screen must not depend on
 * anything that may be what failed. Under Reload, a quiet second way out: sign out and in again.
 */
const CrashScreen: React.FC = () => {
  const title = tr('common.something_wrong');
  useDocumentTitle([title]);
  // No storage outside a browser (the server-side render of the tests): the light theme.
  const t = getTokens(typeof localStorage !== 'undefined' && localStorage.getItem('edging-mail-theme') === 'dark');
  return (
    <div className="au-page" style={{ background: t.bg, color: t.text }}>
      <main className="au-column">
        <div className="au-stage">
          <div className="au-card au-crash">
            <EmptyState
              illustration
              titleAs="h1"
              title={title}
              description={tr('crash.reload_hint')}
              action={
                <Button variant="primary" size="lg" className="au-btn" onClick={() => window.location.reload()}>
                  {tr('crash.reload')}
                </Button>
              }
            />
            <SignOutAgain />
          </div>
        </div>
      </main>
    </div>
  );
};

/** Catches a render error, which would otherwise leave a blank page (after a deploy an old cached client can meet a new API shape). */
export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { failed: true };
  }

  override componentDidCatch(error: unknown): void {
    console.error('The app failed to render', error);
  }

  override render(): React.ReactNode {
    return this.state.failed ? <CrashScreen /> : this.props.children;
  }
}
