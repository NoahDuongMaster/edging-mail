import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { askSession, sessionKey } from './auth';
import { wipeKeysInBackground } from './crypto/keyStore';
import { queryKeys } from './queries';
import { confirmSession, handleSocketClose, SESSION_RENEWED_CLOSE } from './sessionRenewal';

export type RealtimeStatus = 'connecting' | 'open' | 'closed';

const BACKOFF_MIN_MS = 1000;
const BACKOFF_MAX_MS = 30_000;
const PING_INTERVAL_MS = 25_000;
const PONG_TIMEOUT_MS = 10_000;
// Several events (or an event plus a tab switch) arriving together cause one refetch, not one each.
const CATCH_UP_DELAY_MS = 150;
// Sockets that close this many times in a row before the server's hello were refused: the login is probably gone.
const REFUSED_BEFORE_SESSION_CHECK = 3;

/** What a server message means to us: the handshake is done, or the mailbox changed. */
function parseEvent(data: unknown): 'hello' | 'mail' | null {
  if (typeof data !== 'string') {
    return null;
  }
  let message: unknown;
  try {
    message = JSON.parse(data);
  } catch {
    return null;
  }
  const type = typeof message === 'object' && message !== null && 'type' in message ? message.type : null;
  if (type === 'hello') {
    return 'hello';
  }
  return type === 'mail.new' || type === 'mail.changed' ? 'mail' : null;
}

/**
 * Keeps one WebSocket to /api/ws open while `enabled` and refetches the mail lists and counters whenever the server
 * says the mailbox changed, and after anything that may have been missed (reconnect, tab shown, back online).
 */
export function useRealtime(enabled: boolean): RealtimeStatus {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<RealtimeStatus>('connecting');

  useEffect(() => {
    if (!enabled) {
      return;
    }
    let socket: WebSocket | null = null;
    let sawHello = false;
    let hadClose = false;
    let reconnects = 0;
    let refused = 0;
    let stopped = false;
    let retryTimer: number | undefined;
    let pingTimer: number | undefined;
    let pongTimer: number | undefined;
    let catchUpTimer: number | undefined;

    const catchUp = () => {
      window.clearTimeout(catchUpTimer);
      catchUpTimer = window.setTimeout(() => {
        void queryClient.invalidateQueries({ queryKey: queryKeys.messages });
        // The open reader too: a mail changed elsewhere (a snoozed mail woken by the cron) must not stay stale there.
        void queryClient.invalidateQueries({ queryKey: queryKeys.messageDetails });
        void queryClient.invalidateQueries({ queryKey: queryKeys.stats });
        void queryClient.invalidateQueries({ queryKey: queryKeys.labels });
      }, CATCH_UP_DELAY_MS);
    };

    const stopKeepalive = () => {
      window.clearInterval(pingTimer);
      window.clearTimeout(pongTimer);
      pongTimer = undefined;
    };

    // The socket is gone (closed, refused, dead or offline): remember it and say so.
    const lost = () => {
      stopKeepalive();
      socket = null;
      hadClose = true;
      setStatus('closed');
    };

    const scheduleReconnect = () => {
      // Offline: the `online` event reconnects.
      if (stopped || !navigator.onLine) {
        return;
      }
      const delay = Math.min(BACKOFF_MAX_MS, BACKOFF_MIN_MS * 2 ** reconnects);
      reconnects += 1;
      retryTimer = window.setTimeout(connect, delay + Math.random() * delay * 0.25);
    };

    const ping = () => {
      if (socket?.readyState !== WebSocket.OPEN) {
        return;
      }
      socket.send('ping');
      // A connection that went half-open (phone changed network) never answers, and closing it would wait for the peer too.
      pongTimer ??= window.setTimeout(() => {
        const dead = socket;
        lost();
        dead?.close();
        scheduleReconnect();
      }, PONG_TIMEOUT_MS);
    };

    function connect() {
      if (stopped || !navigator.onLine) {
        return;
      }
      setStatus('connecting');
      sawHello = false;
      const ws = new WebSocket(`${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/api/ws`);
      socket = ws;
      ws.addEventListener('open', () => {
        if (ws !== socket) {
          return;
        }
        setStatus('open');
        if (hadClose) {
          catchUp();
        }
        pingTimer = window.setInterval(ping, PING_INTERVAL_MS);
      });
      ws.addEventListener('message', (event: MessageEvent<unknown>) => {
        if (ws !== socket) {
          return;
        }
        // Any traffic, the 'pong' included, proves the connection is alive.
        window.clearTimeout(pongTimer);
        pongTimer = undefined;
        const kind = parseEvent(event.data);
        if (kind === 'hello') {
          sawHello = true;
          reconnects = 0;
          refused = 0;
        } else if (kind === 'mail') {
          catchUp();
        }
      });
      ws.addEventListener('close', (event) => {
        if (ws !== socket) {
          return;
        }
        lost();
        // The Worker closes a socket whose session ended with 4401 (sign-out elsewhere, a reset): no key may outlive it (CK-13). It closes
        // them with 4402 when the person's sessions were renewed (a password change, new recovery codes). The session check then says whether
        // the cookie of this device is still good (the unlock screen asks for the password) or gone.
        handleSocketClose(event.code, {
          wipeKeys: wipeKeysInBackground,
          // A check that cannot be answered is asked again for 30 s, then the keys are wiped and the app locks (SR-1).
          checkSession: () => {
            void confirmSession(() => askSession(queryClient), wipeKeysInBackground);
          }
        });
        if (event.code === SESSION_RENEWED_CLOSE) {
          // The cookie changed: the next socket is opened with the new one, soon.
          reconnects = 0;
        }
        if (!sawHello) {
          refused += 1;
          if (refused >= REFUSED_BEFORE_SESSION_CHECK) {
            refused = 0;
            // A 401 on the handshake looks like any other failure here; the session check settles it.
            void queryClient.invalidateQueries({ queryKey: sessionKey });
          }
        }
        scheduleReconnect();
      });
    }

    const reconnectNow = () => {
      window.clearTimeout(retryTimer);
      connect();
    };

    const onVisibilityChange = () => {
      if (document.visibilityState !== 'visible') {
        return;
      }
      catchUp();
      if (socket === null) {
        reconnectNow();
      } else {
        ping();
      }
    };
    const onOnline = () => {
      catchUp();
      if (socket === null) {
        reconnectNow();
      }
    };
    const onOffline = () => {
      window.clearTimeout(retryTimer);
      const ws = socket;
      lost();
      ws?.close();
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    // Deferred so React StrictMode's throw-away first mount never opens a socket.
    retryTimer = window.setTimeout(connect, 0);

    return () => {
      stopped = true;
      window.clearTimeout(retryTimer);
      window.clearTimeout(catchUpTimer);
      stopKeepalive();
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      const ws = socket;
      socket = null;
      ws?.close();
    };
  }, [enabled, queryClient]);

  return enabled ? status : 'closed';
}
