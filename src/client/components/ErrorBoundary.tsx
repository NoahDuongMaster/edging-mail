import React from 'react';
import { getTokens } from '../theme';
import { tr } from '../lib/i18n';
import { Button, EmptyState } from '../ui';
import './mailbox.css';

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  failed: boolean;
}

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
    if (!this.state.failed) {
      return this.props.children;
    }
    // App holds the theme state and just crashed, so read the stored choice directly. The colours are real values, not variables: this
    // screen must not depend on anything that may be what failed.
    const t = getTokens(window.localStorage.getItem('edging-mail-theme') === 'dark');
    return (
      <main className="mb-status" style={{ background: t.bg, color: t.text }}>
        <EmptyState
          illustration
          title={tr('common.something_wrong')}
          description={tr('crash.reload_hint')}
          action={
            <Button variant="primary" onClick={() => window.location.reload()}>
              {tr('crash.reload')}
            </Button>
          }
        />
      </main>
    );
  }
}
