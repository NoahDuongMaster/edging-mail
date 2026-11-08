import React from 'react';
import ReactDOM from 'react-dom/client';
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
// The base styles and the component library (ui.css) come first, so the stylesheet of each screen, imported by App below, is later in the
// cascade and wins over a ui-* rule of the same specificity.
import './index.css';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { UnauthorizedError } from './lib/api';
import { askSession, endSession, useSession } from './lib/auth';
import { wipeKeysInBackground } from './lib/crypto/keyStore';
import { registerCredentialDeriver } from './lib/crypto/registerDeriver';
import { initLanguage, useLanguageSync } from './lib/i18n';
import { useAdoptDeviceLanguage } from './lib/language';
import { confirmSession, renewalInProgress, whenRenewalEnds } from './lib/sessionRenewal';
import { applyTheme, storedThemeIsDark } from './theme';

// The stored theme is on the page before anything renders (and before the language is loaded), so no screen flashes the wrong one.
applyTheme(storedThemeIsDark());
registerCredentialDeriver();

const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error, query) => {
      console.error('Query failed', query.queryKey, error);
      onApiError(error);
    }
  }),
  mutationCache: new MutationCache({ onError: onApiError }),
  defaultOptions: {
    // No refetch on tab focus: lists and stats refresh on user actions, as before. A 401 is never retried.
    // 'always': a request made offline fails at once and the screen says so. The default would pause it silently, and a
    // paused load looks exactly like an empty folder.
    queries: {
      retry: (failureCount, error) => failureCount < 1 && !(error instanceof UnauthorizedError),
      staleTime: 10_000,
      refetchOnWindowFocus: false,
      networkMode: 'always'
    },
    // 'always': offline, a mutation must fail at once and roll back. The default would pause it and fire it later,
    // so a mail "sent" offline would be delivered silently on reconnect.
    mutations: { retry: false, networkMode: 'always' }
  }
});

// An expired or missing login cookie on any call lands on the login screen. Not while this device is renewing its own session (a password
// change, new recovery codes): a request that went out with the old cookie fails then, and the session check says what is true.
function onApiError(error: unknown) {
  if (error instanceof UnauthorizedError) {
    if (renewalInProgress()) {
      whenRenewalEnds(() => {
        void confirmSession(() => askSession(queryClient), wipeKeysInBackground);
      });
      return;
    }
    endSession(queryClient);
  }
}

// Once the session is known its language (the account's own, else the organisation default) takes over from the boot guess,
// and a choice made in the sign-in picker is saved to an account that has none yet.
function LanguageSync(): null {
  useLanguageSync(useSession().data);
  useAdoptDeviceLanguage();
  return null;
}

// The dev server has no built shell to cache, and a worker there would serve stale code.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((registration) => {
        // A deployed sw.js takes over by itself (skipWaiting); looking for one when the app comes back to the front keeps
        // a long-lived installed app current without a reload.
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') {
            registration.update().catch(() => {
              // offline: the next visit looks again
            });
          }
        });
      })
      .catch((error: unknown) => console.error('Service worker registration failed', error));
  });
}

// The language is resolved and its catalogue loaded BEFORE the first render, so nothing flashes in the wrong language. On a very
// slow connection the first screen does not wait for it for long: it shows in English and switches when the language arrives.
// (After the service-worker block on purpose: that registers its `load` listener before this module waits.)
const LANGUAGE_WAIT_MS = 4000;
const root = document.querySelector('#root');
if (root) {
  await Promise.race([
    initLanguage(),
    new Promise<void>((resolve) => {
      setTimeout(resolve, LANGUAGE_WAIT_MS);
    })
  ]);
  // The dev server's hot reload can run this module again before it reloads the page: a second createRoot on the same element makes two
  // React trees fight over it (a flash of the crash screen). The first root is kept in the hot-reload data and reused. Production has no
  // import.meta.hot, so this is always a new root there.
  const hot = import.meta.hot?.data as { root?: ReactDOM.Root } | undefined;
  const reactRoot = hot?.root ?? ReactDOM.createRoot(root);
  if (hot !== undefined) {
    hot.root = reactRoot;
  }
  reactRoot.render(
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <LanguageSync />
        <ErrorBoundary>
          <App />
        </ErrorBoundary>
      </QueryClientProvider>
    </React.StrictMode>
  );
}
