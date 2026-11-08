import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost, UnauthorizedError } from './api';
import { cannotReachServer, endSession } from './auth';
import type { SignOutPush } from './auth';
import { tr } from './i18n';

export interface PushNotifications {
  /** Browser can do Web Push (service worker + PushManager + Notification). On iOS only inside an installed PWA. */
  supported: boolean;
  permission: NotificationPermission | 'unsupported';
  /** This browser currently has a subscription registered on the server. */
  subscribed: boolean;
  busy: boolean;
  error: string | null;
  enable: () => Promise<void>;
  disable: () => Promise<void>;
  sendTest: () => Promise<void>;
}

interface TestResult {
  sent: number;
  failed: number;
  removed: number;
}

const supported =
  typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && typeof Notification !== 'undefined';

function decodeKey(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replaceAll('-', '+').replaceAll('_', '/');
  return Uint8Array.from(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')), (char) => char.codePointAt(0) ?? 0);
}

function sameKey(current: ArrayBuffer | null, wanted: Uint8Array): boolean {
  const bytes = new Uint8Array(current ?? new ArrayBuffer(0));
  return bytes.length === wanted.length && bytes.every((byte, index) => byte === wanted[index]);
}

async function currentSubscription(): Promise<PushSubscription | null> {
  const registration = await navigator.serviceWorker.getRegistration();
  return registration ? registration.pushManager.getSubscription() : null;
}

// Only production builds register the service worker, and `ready` would wait forever without one.
async function readyRegistration(): Promise<ServiceWorkerRegistration> {
  if ((await navigator.serviceWorker.getRegistration()) === undefined) {
    throw new Error(tr('push.dev_server'));
  }
  return navigator.serviceWorker.ready;
}

const SERVER_CAP_MS = 5000;
const BROWSER_CAP_MS = 3000;

/** What to tell the user when the server could not confirm: the real cause when the network is down, else the generic text. */
export function deviceOffMessage(result: 'failed' | 'offline'): string {
  return result === 'offline' ? cannotReachServer() : tr('push.device_off_failed');
}

// Asks the server to delete this device's row. 401 (the login is already gone) and 404 (no such row) leave nothing to keep either.
// 'offline' = fetch itself failed (TypeError: no network); a refusal, a bad answer or our own timeout (AbortError) is 'failed'.
async function forgetOnServer(endpoint: string): Promise<'ok' | 'signed-out' | 'failed' | 'offline'> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => {
    controller.abort();
  }, SERVER_CAP_MS);
  try {
    const response = await fetch('/api/push/unsubscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint }),
      signal: controller.signal
    });
    if (response.status === 401) {
      return 'signed-out';
    }
    if (response.status === 404) {
      return 'ok';
    }
    // Reading the body counts: a captive portal answers 200 with a page that never touched the row.
    const body = response.ok ? await response.json<{ success?: boolean } | null>() : null;
    return body?.success === true ? 'ok' : 'failed';
  } catch (error) {
    return error instanceof TypeError ? 'offline' : 'failed';
  } finally {
    window.clearTimeout(timer);
  }
}

// The browser's own unsubscribe asks the push service, which can hang on a bad network: wait for it, but not longer than the cap.
function dropInBrowser(subscription: PushSubscription): Promise<void> {
  let timer = 0;
  const capped = new Promise<void>((resolve) => {
    timer = window.setTimeout(resolve, BROWSER_CAP_MS);
  });
  const dropped = (async () => {
    try {
      await subscription.unsubscribe();
    } catch {
      // the push service may be unreachable; the server row is already gone
    }
  })();
  return Promise.race([dropped, capped]).then(() => window.clearTimeout(timer));
}

export type DeviceRemoval = 'removed' | 'signed-out' | 'failed' | 'offline';

/**
 * The push side of a sign-out (CK-16): the endpoint of this browser's subscription goes with the logout request (the Worker deletes that one row
 * in the same batch as the sessions), and the browser's own subscription is dropped once the request has answered. Reading the subscription is
 * local; `sign-out` caps it. Nothing here needs the session, so a network that is down costs nothing.
 */
export function pushForSignOut(): SignOutPush {
  let found: PushSubscription | null = null;
  return {
    endpoint: async () => {
      if (!supported) {
        return null;
      }
      found = await currentSubscription();
      return found?.endpoint ?? null;
    },
    drop: async () => {
      if (found !== null) {
        await dropInBrowser(found);
      }
    }
  };
}

/**
 * Turns push off for this device, server first: the browser keeps its subscription unless the server confirmed that the row is
 * gone, so a failed attempt can simply be repeated (a browser that had dropped it already would leave a row nobody can name again).
 * 'removed' also covers a device that was never subscribed; 'signed-out' means the server answered 401; 'offline' is 'failed' because
 * the network is down (see deviceOffMessage). Never rejects.
 */
export async function removeThisDevice(): Promise<DeviceRemoval> {
  if (!supported) {
    return 'removed';
  }
  const subscription = await currentSubscription().catch(() => null);
  if (!subscription) {
    return 'removed';
  }
  const answer = await forgetOnServer(subscription.endpoint);
  if (answer === 'failed' || answer === 'offline') {
    return answer;
  }
  await dropInBrowser(subscription);
  return answer === 'ok' ? 'removed' : 'signed-out';
}

// Only text we wrote ourselves or the server's own message reaches the screen, never a raw browser exception.
function describe(error: unknown, fallback: string): string {
  if (error instanceof DOMException) {
    if (error.name === 'AbortError') {
      return tr('push.service_unreachable');
    }
    return error.name === 'NotAllowedError' ? tr('push.blocked') : fallback;
  }
  if (error instanceof TypeError) {
    return tr('app.server_unreachable');
  }
  return error instanceof Error && !(error instanceof SyntaxError) && error.message !== '' ? error.message : fallback;
}

export function usePushNotifications(): PushNotifications {
  const queryClient = useQueryClient();
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>(() =>
    supported ? Notification.permission : 'unsupported'
  );
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // On load, ask the browser and the server whether this device is already subscribed.
  useEffect(() => {
    if (!supported) {
      return;
    }
    const unmounted = new AbortController();
    void (async () => {
      try {
        const subscription = await currentSubscription();
        const status = subscription
          ? await apiPost<{ subscribed: boolean }>('/api/push/status', { endpoint: subscription.endpoint }, 'fail.push_status')
          : null;
        if (!unmounted.signal.aborted) {
          setSubscribed(status?.subscribed === true);
        }
      } catch (error_) {
        // A 401 ends the session like every other call; anything else just leaves the switch off.
        if (error_ instanceof UnauthorizedError) {
          endSession(queryClient);
        }
      }
    })();
    return () => {
      unmounted.abort();
    };
  }, [queryClient]);

  // Runs `work` with the busy flag and a readable error. Never rejects: callers are click handlers.
  const run = async (fallback: string, work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (error_) {
      if (error_ instanceof UnauthorizedError) {
        endSession(queryClient);
      } else {
        setError(describe(error_, fallback));
      }
    } finally {
      setBusy(false);
    }
  };

  const enable = async () => {
    if (!supported) {
      return;
    }
    // Permission has to be requested straight from the click, before any other await.
    const permissionRequest = Notification.requestPermission();
    await run(tr('push.turn_on_failed'), async () => {
      const result = await permissionRequest;
      setPermission(result);
      if (result !== 'granted') {
        // 'denied' is explained by the Settings dialog itself.
        if (result === 'default') {
          setError(tr('push.not_allowed'));
        }
        return;
      }
      const registration = await readyRegistration();
      const { publicKey } = await apiGet<{ publicKey: string }>('/api/push/public-key', 'fail.push_key');
      const key = decodeKey(publicKey);
      let subscription = await registration.pushManager.getSubscription();
      if (subscription && !sameKey(subscription.options.applicationServerKey, key)) {
        // Made for another server key: it can never receive our pushes.
        const stale = subscription.endpoint;
        await subscription.unsubscribe();
        try {
          await apiPost('/api/push/unsubscribe', { endpoint: stale }, 'fail.push_unsubscribe');
        } catch {
          // the server drops it itself once the push service answers 404/410
        }
        subscription = null;
      }
      subscription ??= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
      await apiPost('/api/push/subscribe', subscription.toJSON(), 'fail.push_subscribe');
      setSubscribed(true);
    });
  };

  const disable = async () => {
    if (!supported) {
      return;
    }
    await run(tr('push.turn_off_failed'), async () => {
      const result = await removeThisDevice();
      if (result === 'failed' || result === 'offline') {
        // Nothing was dropped in the browser, so the switch stays on and the next click can try again.
        throw new Error(deviceOffMessage(result));
      }
      setSubscribed(false);
      if (result === 'signed-out') {
        endSession(queryClient);
      }
    });
  };

  const sendTest = async () => {
    await run(tr('push.test_failed'), async () => {
      const { sent, failed, removed } = await apiPost<TestResult>('/api/push/test', {}, 'fail.push_test');
      if (sent > 0) {
        return;
      }
      if (failed > 0) {
        throw new Error(tr('push.service_rejected'));
      }
      throw new Error(removed > 0 ? tr('push.device_unknown') : tr('push.no_device'));
    });
  };

  return { supported, permission, subscribed, busy, error, enable, disable, sendTest };
}
