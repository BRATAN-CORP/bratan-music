/**
 * Drop-in replacement for the Durable Object ChatRoomDO.
 *
 * On CF Workers, each listening room gets a DO instance that holds live
 * WebSocket connections. On Node, we maintain a global Map of room sockets
 * and provide a DurableObjectNamespace-like façade.
 *
 * The adapter exposes:
 *   env.CHAT_ROOM.idFromName(roomId) → { name: string }
 *   env.CHAT_ROOM.get(id) → stub with .fetch(Request) → Response
 *
 * The stub handles two paths:
 *   /connect  — WebSocket upgrade
 *   /broadcast — POST JSON to push to all connected sockets
 */

import { WebSocketServer, WebSocket as WsWebSocket } from 'ws';
import type { IncomingMessage } from 'http';
import type { Server } from 'http';

/* ── Per-room state ──────────────────────────────────── */

const ROOM_SOCKET_LIMIT = 32;

interface RoomState {
  sockets: Set<WsWebSocket>;
}

const rooms = new Map<string, RoomState>();

function getRoom(roomId: string): RoomState {
  let room = rooms.get(roomId);
  if (!room) {
    room = { sockets: new Set() };
    rooms.set(roomId, room);
  }
  return room;
}

/* ── WebSocket server (attach to HTTP server) ────────── */

let wss: WebSocketServer | null = null;

export function attachWebSocketServer(server: Server): void {
  wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req: IncomingMessage, socket, head) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
    // Expected path: /rooms/:id/ws
    const match = url.pathname.match(/^\/rooms\/([^/]+)\/ws$/);
    if (!match) {
      socket.destroy();
      return;
    }

    const roomId = match[1];
    wss!.handleUpgrade(req, socket, head, (ws) => {
      const room = getRoom(roomId);

      if (room.sockets.size >= ROOM_SOCKET_LIMIT) {
        ws.close(4000, 'Room full');
        return;
      }

      room.sockets.add(ws);

      // Send hello
      ws.send(JSON.stringify({ kind: 'hello', serverNowMs: Date.now() }));

      ws.on('close', () => {
        room.sockets.delete(ws);
        if (room.sockets.size === 0) rooms.delete(roomId);
      });

      ws.on('error', () => {
        room.sockets.delete(ws);
      });

      // The DO doesn't accept inbound messages — neither do we
    });
  });
}

/** Broadcast a message to all connected sockets in a room. */
function broadcastToRoom(roomId: string, payload: unknown): void {
  const room = rooms.get(roomId);
  if (!room) return;
  const json = JSON.stringify({ kind: 'message', ...payload as object });
  for (const ws of room.sockets) {
    if (ws.readyState === WsWebSocket.OPEN) {
      ws.send(json);
    }
  }
}

/* ── DurableObjectNamespace-compatible facade ────────── */

interface DOId {
  name: string;
}

class DOStub {
  constructor(private roomId: string) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.endsWith('/broadcast')) {
      try {
        const body = await request.json() as { message: unknown };
        broadcastToRoom(this.roomId, body);
      } catch {
        // ignore
      }
      return new Response('ok');
    }

    if (url.pathname.endsWith('/connect')) {
      // For the Node adapter, the actual WebSocket upgrade is handled
      // by the HTTP server's 'upgrade' event (attachWebSocketServer).
      // The route that calls this should instead redirect to the ws path.
      return new Response('WebSocket upgrade handled by HTTP server', { status: 101 });
    }

    return new Response('not found', { status: 404 });
  }
}

export class DurableObjectNamespaceAdapter {
  idFromName(name: string): DOId {
    return { name };
  }

  get(id: DOId): DOStub {
    return new DOStub(id.name);
  }
}
