import React from 'react';
import ReactDOM from 'react-dom/client';
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { UnauthorizedError } from './lib/api';
import { endSession } from './lib/auth';
import './index.css';

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

// An expired or missing login cookie on any call lands on the login screen.
function onApiError(error: unknown) {
  if (error instanceof UnauthorizedError) {
    endSession(queryClient);
  }
}

const root = document.querySelector('#root');
if (root) {
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <ErrorBoundary>
          <App />
        </ErrorBoundary>
      </QueryClientProvider>
    </React.StrictMode>
  );
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
