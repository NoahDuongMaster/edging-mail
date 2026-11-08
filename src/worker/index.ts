import { Hono } from 'hono';
import type { MiddlewareHandler } from 'hono';
import { secureHeaders } from 'hono/secure-headers';
import type { AppEnv, Env } from './types';
import { adminRoutes, applyDueTwoFactorResets } from './admin';
import { apiError, codeFor, withErrorCodes } from './errors';
import { getDb } from './db';
import { HTTPException } from 'hono/http-exception';
import { authenticate, authRoutes, keyRoutes, requireAdmin, verifiedUser } from './auth';
import { capBody } from './body-cap';
import { draftRoutes } from './drafts';
import { encryptLegacyMail } from './encrypt-job';
import { receiveEmail } from './inbound';
import { purgeLockedMail } from './locked-job';
import { pruneActivity } from './maintenance';
import { messageRoutes } from './mail/messages';
import { rewrapPending } from './mail/pending';
import { internalRoutes } from './mail/internal';
import { settingsRoutes } from './mail/settings';
import { transferRoutes } from './mail/transfer';
import { pushRoutes } from './push';
import { realtimeRoutes } from './realtime';
import { handleSite } from './site';
import { returnSnoozedMail } from './snooze';
import { neverKeepAnError } from './static-miss';
import { appName, errorClass } from './utils';

// The Durable Object class must be exported from the entry module (see durable_objects in wrangler.jsonc).
export { MailHub } from './realtime';

const app = new Hono<AppEnv>();

// Exported for the route-table test (test/gate.test.ts), which derives its list of routes from app.routes.
export { app };

// Browsers always send Sec-Fetch-Site (fetch, XHR, navigation) and page scripts cannot forge it; curl and Wrangler's
// email handler send none. Only the app's own origin (or the user typing the URL) may call the API: this stops
// cross-site and same-site (sibling subdomain) requests. No CORS headers.
const isLoopbackHost = (hostname: string): boolean => ['localhost', '127.0.0.1', '[::1]'].includes(hostname);

const hostnameOf = (origin: string): string => {
  try {
    return new URL(origin).hostname;
  } catch {
    return '';
  }
};

const sameOriginOnly: MiddlewareHandler = async (c, next) => {
  const site = c.req.header('Sec-Fetch-Site');
  if (site !== undefined && site !== 'same-origin' && site !== 'none') {
    return apiError(c, 'forbidden');
  }
  // Chromium sends no Sec-Fetch-Site on WebSocket handshakes, only Origin: without this check a page on a sibling
  // subdomain could open the cookie-authenticated socket and read incoming mail events.
  if (c.req.header('Upgrade')?.toLowerCase() === 'websocket') {
    const origin = c.req.header('Origin');
    if (origin !== undefined) {
      const own = new URL(c.req.url);
      // Local dev reaches the worker through the Vite proxy, which keeps the page's origin (another port).
      const loopbackDev = isLoopbackHost(own.hostname) && isLoopbackHost(hostnameOf(origin));
      if (origin !== own.origin && !loopbackDev) {
        return apiError(c, 'forbidden');
      }
    }
  }
  await next();
};

// JSON answers hold private mail data: never cache them. Downloads (octet-stream) and the WebSocket upgrade are left alone.
const noStoreJson: MiddlewareHandler = async (c, next) => {
  await next();
  if (c.res.headers.get('Content-Type')?.startsWith('application/json') === true) {
    c.header('Cache-Control', 'no-store');
  }
};

// secureHeaders() rewrites response headers, which workerd forbids on the 101 response of a WebSocket upgrade.
// Strict-Transport-Security belongs on https responses only (browsers ignore it over http; local dev runs on http).
const applySecureHeaders = secureHeaders();
const applySecureHeadersOverHttp = secureHeaders({ strictTransportSecurity: false });
const secureHeadersExceptUpgrade: MiddlewareHandler = (c, next) => {
  if (c.req.header('Upgrade') !== undefined) {
    return next();
  }
  return (new URL(c.req.url).protocol === 'https:' ? applySecureHeaders : applySecureHeadersOverHttp)(c, next);
};

// Global middleware
app.use('/api/*', sameOriginOnly);
app.use('/api/*', secureHeadersExceptUpgrade);
app.use('/api/*', noStoreJson);
// Every error answer leaves with a stable registry `code` (see errors.ts), also one a route wrote without it.
app.use('/api/*', withErrorCodes);
// No JSON body is read whole before it is looked at (PX-5): see body-cap.ts.
app.use('/api/*', capBody);
// Every /api route needs a real session (a user that exists, is active and was not signed out) except /api/health and the sign-in,
// setup and recovery endpoints, so this stays above all route registrations: a route added later is private by default.
app.use('/api/*', authenticate);
// Administrator routes (/api/admin/*) additionally need the admin role.
app.use('/api/admin/*', requireAdmin);

app.onError((error, c) => {
  if (error instanceof HTTPException) {
    return c.json({ success: false, error: error.message, code: codeFor(error.status, error.message) }, error.status);
  }
  console.error('[edging-mail] Unhandled error:', errorClass(error));
  return apiError(c, 'server_error');
});
app.notFound((c) => apiError(c, 'not_found'));

app.route('/api/auth', authRoutes);
app.route('/api/admin', adminRoutes);
app.route('/api/keys', keyRoutes);

// Realtime (WebSocket) and Web Push routes
app.route('/api/push', pushRoutes);
app.route('/api/drafts', draftRoutes);
app.route('/api', realtimeRoutes);

// Health & Info
app.get('/api/health', (c) => {
  return c.json({
    status: 'ok',
    app: appName(c.env),
    edge: 'Cloudflare Workers',
    timestamp: Date.now()
  });
});

// Mail: folders, lists, messages, labels, send, attachments, raw downloads and the signed-in user's settings. Every query is scoped
// to the signed-in user (see mail/view.ts ownedBy).
app.route('/api', messageRoutes);
app.route('/api', transferRoutes);
app.route('/api', internalRoutes);
app.route('/api', settingsRoutes);

// Cloudflare Worker Export with both fetch (Web API/UI) and email (Cloudflare Email Routing)
export default {
  // Cron Trigger (every minute, see wrangler.jsonc): snoozed mail whose time has come returns to the inbox; pending mail whose owner has a
  // key by now is sealed to it; plaintext mail from before the encryption is converted in small chunks; locked old mail whose deletion was
  // asked for seven days ago is deleted; once an hour, old sign-in records are pruned.
  scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): void {
    ctx.waitUntil(returnSnoozedMail(env));
    ctx.waitUntil(rewrapPending(env));
    ctx.waitUntil(encryptLegacyMail(env));
    ctx.waitUntil(applyDueTwoFactorResets(env, getDb(env.DB)));
    ctx.waitUntil(purgeLockedMail(env));
    if (new Date(controller.scheduledTime).getUTCMinutes() === 7) {
      ctx.waitUntil(pruneActivity(env));
    }
  },

  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Serve API routes with Hono
    if (url.pathname.startsWith('/api')) {
      return app.fetch(request, env, ctx);
    }

    // The public site answers its own paths first (landing, robots, sitemap, app shell); undefined = not its path.
    const site = await handleSite(request, env, ctx, () => verifiedUser(request, env).then(Boolean));
    if (site !== undefined) {
      return site;
    }

    // Serve Static SPA Assets (Vite Client build). A miss is answered by the assets layer; it must not be cached (PX-13).
    if (env.ASSETS) {
      return neverKeepAnError(await env.ASSETS.fetch(request));
    }

    return new Response(`${appName(env)} Backend Ready. Build client to see Web UI.`, {
      headers: { 'Content-Type': 'text/plain' }
    });
  },

  // Inbound Email Routing Handler (triggers automatically on incoming emails)
  async email(message: ForwardableEmailMessage, env: Env): Promise<void> {
    await receiveEmail(message, env);
  }
};
