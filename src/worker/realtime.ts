import { DurableObject } from 'cloudflare:workers';
import { Hono } from 'hono';
import { currentUser } from './auth/middleware';
import { sessionEndsAt } from './auth/session';
import type { AppEnv, Env } from './types';
import { apiError } from './errors';
import { errorClass } from './utils';

// WebSocket close codes the Worker uses (4000-4999 are for applications). 4401: the session ended, so the browser must lock and wipe its key.
// 4402: the user's sessions were revoked by a change that renewed the caller's own session in the same answer; reconnect once with the new cookie.
export const CLOSE_SESSION_ENDED = 4401;
export const CLOSE_SESSION_RENEWED = 4402;

// The Worker tells the hub when the session behind a socket ends (epoch ms, from the cookie's own expiry) in this header; a socket is closed with
// 4401 at that time, from an alarm, and is never sent an event after it (PX-8). A connection without it is refused: fail closed.
const SESSION_END_HEADER = 'X-Session-End';

/** The end of the session behind a socket, as stored with it when it was accepted; 0 (already over) for one that has none. */
const endOf = (socket: WebSocket): number => {
  const stored = socket.deserializeAttachment() as { end?: unknown } | null;
  return typeof stored?.end === 'number' ? stored.end : 0;
};

export type MailEvent =
  | {
      type: 'mail.new';
      id: string;
      folder: string;
      from_name: string | null;
      from_address: string;
      created_at: number;
    }
  | { type: 'mail.changed' };

/**
 * One instance per user (`idFromName('user:<id>')`) holds that user's open browser WebSockets, so an event can only ever reach its owner's
 * tabs. It uses the hibernatable WebSocket API, so idle sockets cost nothing: the object is evicted from memory and woken by a
 * message, a close or a /broadcast.
 */
export class MailHub extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Answered by the runtime without waking the object, so client keep-alive pings are free.
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade')?.toLowerCase() === 'websocket') {
      const end = Number(request.headers.get(SESSION_END_HEADER));
      if (!Number.isFinite(end) || end <= Date.now()) {
        return new Response(null, { status: 401 });
      }
      const { 0: client, 1: server } = new WebSocketPair();
      server.serializeAttachment({ end });
      this.ctx.acceptWebSocket(server);
      await this.wakeAtOrBefore(end);
      server.send(JSON.stringify({ type: 'hello' }));
      return new Response(null, { status: 101, webSocket: client });
    }

    if (request.method === 'POST' && new URL(request.url).pathname === '/broadcast') {
      const message = await request.text();
      let delivered = 0;
      const now = Date.now();
      for (const socket of this.ctx.getWebSockets()) {
        if (endOf(socket) <= now) {
          // The session behind it is over (the alarm has not run yet, or never was armed): nothing more is sent to it.
          this.closeQuietly(socket, CLOSE_SESSION_ENDED, 'session expired');
          continue;
        }
        // One broken socket must not stop the others from getting the event.
        try {
          socket.send(message);
          delivered += 1;
        } catch (error) {
          console.error('[edging-mail] realtime: dropping a dead WebSocket:', errorClass(error));
          this.closeQuietly(socket, 1011, 'send failed');
        }
      }
      return Response.json({ success: true, delivered });
    }

    // The user's sessions were revoked (sign out, password change or reset, disable, role change, delete): end every socket. A change that
    // renews the caller's own session in the same answer (password, two-step verification) closes with 4402 instead of 4401, so that
    // browser keeps its key and reconnects with the new cookie; the sockets of other devices reconnect with a revoked cookie and are refused.
    if (request.method === 'POST' && new URL(request.url).pathname === '/close') {
      const renewed = new URL(request.url).searchParams.get('reason') === 'renewed';
      const sockets = this.ctx.getWebSockets();
      for (const socket of sockets) {
        this.closeQuietly(socket, renewed ? CLOSE_SESSION_RENEWED : CLOSE_SESSION_ENDED, renewed ? 'session renewed' : 'session ended');
      }
      return Response.json({ success: true, closed: sockets.length });
    }

    return Response.json({ success: false, error: 'Not found', code: 'not_found' }, { status: 404 });
  }

  /** The alarm is the earliest end of any open socket: it closes the ones whose session is over and arms itself for the next. */
  async alarm(): Promise<void> {
    const now = Date.now();
    let next: number | undefined;
    for (const socket of this.ctx.getWebSockets()) {
      const end = endOf(socket);
      if (end <= now) {
        this.closeQuietly(socket, CLOSE_SESSION_ENDED, 'session expired');
      } else {
        next = Math.min(next ?? end, end);
      }
    }
    if (next !== undefined) {
      await this.ctx.storage.setAlarm(next);
    }
  }

  private async wakeAtOrBefore(end: number): Promise<void> {
    const armed = await this.ctx.storage.getAlarm();
    if (armed === null || end < armed) {
      await this.ctx.storage.setAlarm(end);
    }
  }

  webSocketMessage(): void {
    // Clients only send 'ping', which the auto-response above answers; anything else is ignored.
  }

  webSocketClose(ws: WebSocket): void {
    this.closeQuietly(ws, 1000, 'closing');
  }

  webSocketError(ws: WebSocket, error: unknown): void {
    console.error('[edging-mail] realtime: WebSocket error:', errorClass(error));
    this.closeQuietly(ws, 1011, 'error');
  }

  // Closing completes the handshake; it throws when the peer is already gone, which is the state we want anyway.
  private closeQuietly(ws: WebSocket, code: number, reason: string): void {
    try {
      ws.close(code, reason);
    } catch {
      // already closed
    }
  }
}

const hub = (env: Env, userId: string): DurableObjectStub => env.MAIL_HUB.get(env.MAIL_HUB.idFromName(`user:${userId}`));

export const realtimeRoutes = new Hono<AppEnv>();

// The auth middleware has already authenticated the caller; the upgrade goes to that user's own object and nobody else's.
// Both branches answer a plain Response (an async handler with one return type), which every TypeScript version of the toolchain accepts.
realtimeRoutes.get('/ws', async (c): Promise<Response> => {
  if (c.req.header('Upgrade')?.toLowerCase() !== 'websocket') {
    return c.json({ success: false, error: 'Expected a WebSocket upgrade request', code: 'upgrade_required' }, 426, {
      Upgrade: 'websocket'
    });
  }
  // The session ends when its cookie does (PX-8): the hub is told when, and closes the socket then. Anything a caller sent under that header is replaced.
  const end = await sessionEndsAt(c.req.raw, c.env);
  if (end === undefined) {
    return apiError(c, 'unauthorized');
  }
  const headers = new Headers(c.req.raw.headers);
  headers.set(SESSION_END_HEADER, String(end));
  return hub(c.env, currentUser(c).id).fetch(new Request(c.req.raw, { headers }));
});

/** Pushes an event to the connected browsers of ONE user. Never throws: realtime is best-effort, the mail is already stored. */
export async function broadcast(env: Env, userId: string, event: MailEvent): Promise<void> {
  try {
    const response = await hub(env, userId).fetch('https://mail-hub/broadcast', { method: 'POST', body: JSON.stringify(event) });
    if (!response.ok) {
      console.error(`[edging-mail] realtime: broadcast failed with HTTP ${response.status}`);
    }
  } catch (error) {
    console.error('[edging-mail] realtime: broadcast failed:', errorClass(error));
  }
}

/** Closes every open WebSocket of a user, after their sessions were revoked. Never throws. `renewed`: the caller's own session was renewed too. */
export async function closeSockets(env: Env, userId: string, options: { renewed?: boolean } = {}): Promise<void> {
  try {
    await hub(env, userId).fetch(`https://mail-hub/close${options.renewed === true ? '?reason=renewed' : ''}`, { method: 'POST' });
  } catch (error) {
    console.error('[edging-mail] realtime: closing sockets failed:', errorClass(error));
  }
}
