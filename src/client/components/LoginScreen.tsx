import React from 'react';
import { Loader2 } from 'lucide-react';
import type { ThemeTokens } from '../theme';
import { useLogin } from '../lib/auth';
import { Wordmark } from './BrandMark';

interface LoginScreenProps {
  t: ThemeTokens;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({ t }) => {
  const [password, setPassword] = React.useState('');
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const { mutate: login, isPending, error } = useLogin();

  // Not the autoFocus attribute (jsx-a11y/no-autofocus): focus the field once the screen is shown.
  React.useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const submit = (event: React.SyntheticEvent) => {
    event.preventDefault();
    if (isPending || password === '') {
      return;
    }
    login(password, {
      onError: () => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    });
  };

  return (
    <main
      style={{
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
        background: t.bg,
        color: t.text,
        overflowY: 'auto'
      }}
    >
      <form
        onSubmit={submit}
        className="nm-fade-in"
        style={{
          width: '100%',
          maxWidth: 360,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'stretch',
          gap: 16,
          padding: 24,
          background: t.surface,
          border: `1px solid ${t.border}`,
          borderRadius: 16,
          boxShadow: '0 1px 2px rgba(16,24,40,0.05), 0 16px 40px -16px rgba(16,24,40,0.16)'
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
          <img src="/edgar.svg" alt="" width={112} height={109} style={{ display: 'block' }} />
          <Wordmark t={t} />
          <h1 style={{ margin: 0, fontSize: 22, lineHeight: '28px', fontWeight: 600, letterSpacing: '-0.01em' }}>Sign in</h1>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label htmlFor="login-password" style={{ fontSize: 13, fontWeight: 500, color: t.text2 }}>
            Password
          </label>
          <input
            id="login-password"
            ref={inputRef}
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-invalid={error !== null}
            aria-describedby={error === null ? undefined : 'login-error'}
            style={{
              width: '100%',
              height: 44,
              padding: '0 12px',
              border: `1px solid ${t.borderStrong}`,
              borderRadius: 10,
              background: t.raised,
              color: t.text,
              font: 'inherit',
              fontSize: 16
            }}
          />
          {error === null ? null : (
            <p id="login-error" role="alert" style={{ margin: 0, fontSize: 13, color: t.dark ? '#F97066' : '#B42318' }}>
              {error.message}
            </p>
          )}
        </div>

        <button
          type="submit"
          disabled={isPending || password === ''}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            height: 44,
            border: 0,
            borderRadius: 10,
            background: t.accent,
            color: '#FFFFFF',
            fontSize: 15,
            fontWeight: 600,
            cursor: isPending ? 'progress' : password === '' ? 'not-allowed' : 'pointer',
            opacity: isPending || password === '' ? 0.6 : 1
          }}
        >
          {isPending ? <Loader2 size={18} className="nm-spin" aria-hidden="true" /> : null}
          {isPending ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </main>
  );
};
