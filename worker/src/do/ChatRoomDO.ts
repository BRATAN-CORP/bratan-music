/**
 * Per-room broadcast hub for the listening-room chat. The HTTP POST to
 * /rooms/:id/chat is authoritative — it persists the message to D1 and
 * returns the canonical row to the sender. After the insert lands, the
 * route also nudges the room's Durable Object via `/broadcast` so every
 * other tab with an open WebSocket sees the message immediately,
 * instead of waiting for its next polling tick.
 *
 * Invariants:
 *   - The DO never owns the message data — D1 does. If the DO crashes,
 *     restarts or fails to broadcast, the next polling round on the
 *     receiver still picks the row up via `?since=<id>`.
 *   - The DO holds at most ROOM_SOCKET_LIMIT live sockets per room. If
 *     a malicious client tries to fan-out we close excess sockets
 *     immediately so the DO's per-instance memory can't be drained.
 *   - Messages flowing back to the client are ALWAYS already-persisted
 *     rows, so the client can deduplicate by id (it already does for
 *     the polling path).
 *
 * The ws<->client wire protocol is intentionally trivial — we send a
 * JSON envelope `{kind: 'message', message: RoomMessage}` for new rows
 * and `{kind: 'hello', serverNowMs: number}` after the upgrade so the
 * client can sync clocks. No client→server messages are accepted (the
 * canonical write path is the existing POST /chat); any inbound WS
 * frame is dropped.
 */

const ROOM_SOCKET_LIMIT = 32;

interface BroadcastEnvelope {
  message: {
    id: number;
    userId: string;
    username: string | null;
    name: string | null;
    body: string;
    createdAtMs: number;
  };
}

export class ChatRoomDO {
  private state: DurableObjectState;
  private sockets: Set<WebSocket> = new Set();

  constructor(state: DurableObjectState, _env: unknown) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.endsWith('/connect')) {
      return this.handleConnect(request);
    }
    if (url.pathname.endsWith('/broadcast')) {
      return this.handleBroadcast(request);
    }
    return new Response('not found', { status: 404 });
  }

  private async handleConnect(request: Request): Promise<Response> {
    const upgradeHeader = request.headers.get('Upgrade');
    if (upgradeHeader !== 'websocket') {
      return new Response('expected websocket', { status: 426 });
    }
    if (this.sockets.size >= ROOM_SOCKET_LIMIT) {
      // Refuse rather than evict — kicking a long-lived listener would
      // make the chat flicker for an established user just because
      // another tab joined.
      return new Response('room socket limit reached', { status: 429 });
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];

    server.accept();
    this.sockets.add(server);

    // Tell the client the upgrade succeeded and pass a server clock so
    // it can render relative times consistently from the moment the
    // socket opens.
    try {
      server.send(JSON.stringify({ kind: 'hello', serverNowMs: Date.now() }));
    } catch {
      // socket might have closed in the same tick — drop it
      this.sockets.delete(server);
    }

    server.addEventListener('close', () => {
      this.sockets.delete(server);
    });
    server.addEventListener('error', () => {
      this.sockets.delete(server);
    });
    // We don't accept any client-side frames; ignore inbound payloads.
    // (`message` listener is intentionally omitted.)

    return new Response(null, { status: 101, webSocket: client });
  }

  private async handleBroadcast(request: Request): Promise<Response> {
    if (request.method !== 'POST') {
      return new Response('method not allowed', { status: 405 });
    }
    let envelope: BroadcastEnvelope;
    try {
      envelope = await request.json<BroadcastEnvelope>();
    } catch {
      return new Response('invalid body', { status: 400 });
    }
    if (!envelope?.message) {
      return new Response('missing message', { status: 400 });
    }
    const payload = JSON.stringify({ kind: 'message', message: envelope.message });
    let delivered = 0;
    const dead: WebSocket[] = [];
    for (const ws of this.sockets) {
      try {
        ws.send(payload);
        delivered += 1;
      } catch {
        // Socket closed mid-broadcast — schedule for removal.
        dead.push(ws);
      }
    }
    for (const ws of dead) this.sockets.delete(ws);
    return Response.json({ ok: true, delivered });
  }
}
