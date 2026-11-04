import { DurableObject } from 'cloudflare:workers';
import { Hono } from 'hono';
import type { Env } from './types';

export type MailEvent =
  | {
      type: 'mail.new';
      id: string;
      folder: string;
      from_name: string | null;
      from_address: string;
      subject: string;
      snippet: string;
      created_at: number;
    }
  | { type: 'mail.changed' };

/**
 * One instance (`idFromName('main')`) holds every open browser WebSocket. It uses the hibernatable WebSocket API, so
 * idle sockets cost nothing: the object is evicted from memory and woken by a message, a close or a /broadcast.
 */
export class MailHub extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Answered by the runtime without waking the object, so client keep-alive pings are free.
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade')?.toLowerCase() === 'websocket') {
      const { 0: client, 1: server } = new WebSocketPair();
      this.ctx.acceptWebSocket(server);
      server.send(JSON.stringify({ type: 'hello' }));
      return new Response(null, { status: 101, webSocket: client });
    }

    if (request.method === 'POST' && new URL(request.url).pathname === '/broadcast') {
      const message = await request.text();
      let delivered = 0;
      for (const socket of this.ctx.getWebSockets()) {
        // One broken socket must not stop the others from getting the event.
        try {
          socket.send(message);
          delivered += 1;
        } catch (error) {
          console.error('[edging-mail] realtime: dropping a dead WebSocket:', error);
          this.closeQuietly(socket, 1011, 'send failed');
        }
      }
      return Response.json({ success: true, delivered });
    }

    return Response.json({ success: false, error: 'Not found' }, { status: 404 });
  }

  webSocketMessage(): void {
    // Clients only send 'ping', which the auto-response above answers; anything else is ignored.
  }

  webSocketClose(ws: WebSocket): void {
    this.closeQuietly(ws, 1000, 'closing');
  }

  webSocketError(ws: WebSocket, error: unknown): void {
    console.error('[edging-mail] realtime: WebSocket error:', error);
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

const hub = (env: Env): DurableObjectStub => env.MAIL_HUB.get(env.MAIL_HUB.idFromName('main'));

export const realtimeRoutes = new Hono<{ Bindings: Env }>();

realtimeRoutes.get('/ws', (c) => {
  if (c.req.header('Upgrade')?.toLowerCase() !== 'websocket') {
    return c.json({ success: false, error: 'Expected a WebSocket upgrade request' }, 426, { Upgrade: 'websocket' });
  }
  return hub(c.env).fetch(c.req.raw);
});

/** Pushes an event to every connected browser. Never throws: realtime is best-effort, the mail is already stored. */
export async function broadcast(env: Env, event: MailEvent): Promise<void> {
  try {
    const response = await hub(env).fetch('https://mail-hub/broadcast', { method: 'POST', body: JSON.stringify(event) });
    if (!response.ok) {
      console.error(`[edging-mail] realtime: broadcast failed with HTTP ${response.status}`);
    }
  } catch (error) {
    console.error('[edging-mail] realtime: broadcast failed:', error);
  }
}
