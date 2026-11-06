import React from 'react';
import { getTokens } from '../theme';

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
    // App holds the theme state and just crashed, so read the stored choice directly.
    const t = getTokens(window.localStorage.getItem('edging-mail-theme') === 'dark');
    return (
      <main
        style={{
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 12,
          padding: 16,
          textAlign: 'center',
          background: t.bg,
          color: t.text
        }}
      >
        <img src="/edgar.svg" alt="" width={112} height={109} style={{ display: 'block', maxWidth: '100%', height: 'auto' }} />
        <p style={{ margin: 0, fontWeight: 600 }}>Something went wrong.</p>
        <p style={{ margin: 0, color: t.text2 }}>Reload to try again. Your mail is safe on the server.</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          style={{
            height: 44,
            padding: '0 16px',
            border: `1px solid ${t.borderStrong}`,
            borderRadius: 10,
            background: t.surface,
            color: t.text,
            font: 'inherit',
            fontWeight: 500,
            cursor: 'pointer'
          }}
        >
          Reload
        </button>
      </main>
    );
  }
}
