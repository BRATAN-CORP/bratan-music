package services

import (
	"context"
	"encoding/json"
	"sync"
	"time"

	"github.com/coder/websocket"
)

// RoomHub is the in-process replacement for ChatRoomDO. Each listening
// room maps to a `*roomConns` slot keyed by roomId, holding the set of
// live WebSocket connections for that room.
//
// Why in-process (vs Redis pubsub):
//   - The Go API is a single-process replacement for the legacy Worker
//     Durable Object surface; horizontal scale-out is not on the
//     roadmap for v1 of the rewrite (nginx fronts a single api-go
//     instance), so a global Hub is sufficient.
//   - Messages are *already persisted* to Postgres in the same request
//     that triggers the broadcast — the polling fallback every client
//     runs picks up anything the hub misses, so this layer doesn't
//     need delivery guarantees.
//   - When we eventually run >1 api-go replica behind nginx, we'll
//     plug a Redis pubsub fan-out under this same `Broadcast` surface
//     without changing the route handlers.
type RoomHub struct {
	mu    sync.Mutex
	rooms map[string]*roomConns
}

// roomSocketLimit caps the per-room concurrent connections. Matches
// the ChatRoomDO `ROOM_SOCKET_LIMIT` const; a malicious client opening
// thousands of sockets on one room can't drain server memory.
const roomSocketLimit = 32

// writeTimeout is the per-broadcast write deadline. A WS write
// blocking for longer than this is treated as a dead connection and
// closed silently.
const writeTimeout = 5 * time.Second

type roomConns struct {
	conns map[*websocket.Conn]struct{}
}

// NewRoomHub returns a fresh empty hub. Call once at startup and store
// the result on `*app.App.RoomHub`.
func NewRoomHub() *RoomHub {
	return &RoomHub{rooms: make(map[string]*roomConns)}
}

// Add registers a new connection for the room. Returns `false` when
// the per-room cap is hit so the caller can close with the canonical
// "room full" code before adding it to the hub.
func (h *RoomHub) Add(roomID string, c *websocket.Conn) bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	rc, ok := h.rooms[roomID]
	if !ok {
		rc = &roomConns{conns: make(map[*websocket.Conn]struct{})}
		h.rooms[roomID] = rc
	}
	if len(rc.conns) >= roomSocketLimit {
		return false
	}
	rc.conns[c] = struct{}{}
	return true
}

// Remove drops a connection from the hub. Idempotent — calling on an
// already-removed conn is a no-op.
func (h *RoomHub) Remove(roomID string, c *websocket.Conn) {
	h.mu.Lock()
	defer h.mu.Unlock()
	rc, ok := h.rooms[roomID]
	if !ok {
		return
	}
	delete(rc.conns, c)
	if len(rc.conns) == 0 {
		delete(h.rooms, roomID)
	}
}

// Broadcast sends `payload` (already-marshalled JSON) to every live
// connection in the room. Failed writes drop the connection from the
// hub but don't surface as an error to the caller — the polling
// fallback covers the loss.
func (h *RoomHub) Broadcast(roomID string, payload []byte) int {
	// Snapshot under the lock, then write outside it so a slow
	// connection doesn't block the next broadcast on the same room.
	h.mu.Lock()
	rc, ok := h.rooms[roomID]
	if !ok {
		h.mu.Unlock()
		return 0
	}
	conns := make([]*websocket.Conn, 0, len(rc.conns))
	for c := range rc.conns {
		conns = append(conns, c)
	}
	h.mu.Unlock()

	delivered := 0
	for _, c := range conns {
		ctx, cancel := context.WithTimeout(context.Background(), writeTimeout)
		err := c.Write(ctx, websocket.MessageText, payload)
		cancel()
		if err != nil {
			h.Remove(roomID, c)
			continue
		}
		delivered++
	}
	return delivered
}

// BroadcastMessage is the high-level helper the chat route uses. It
// JSON-encodes the canonical envelope `{kind:'message', message}` so
// the wire shape matches the ChatRoomDO and the existing frontend.
func (h *RoomHub) BroadcastMessage(roomID string, msg *RoomMessage) {
	payload, err := json.Marshal(map[string]any{
		"kind":    "message",
		"message": msg,
	})
	if err != nil {
		return
	}
	h.Broadcast(roomID, payload)
}
