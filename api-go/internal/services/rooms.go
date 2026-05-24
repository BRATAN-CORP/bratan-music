package services

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// Shared listening rooms — port of worker/src/services/RoomService.ts.
//
// Sync protocol is "polling-based, server-anchored time":
//
//   - The server stores `started_at_ms` (server epoch when the current
//     play span began) plus `position_ms` (the offset within the track
//     at which that span starts). When `is_paused = 1`, the position
//     is frozen at `position_ms`. When `is_paused = 0`, clients
//     compute position as `Date.now() - started_at_ms + position_ms`
//     after correcting for clock skew via `serverNowMs`.
//
//   - The state row carries a monotonic `version` that the controller
//     bumps on every meaningful change. The client polls
//     `GET /rooms/:id/state` every ~1.5s and only acts when version
//     advances past what it last applied.
//
//   - Anyone who is a current member can take control. Whoever called
//     last is recorded as `controller_id` so the UI can render
//     attribution ("Маша поставила на паузу"). This matches the
//     user-facing requirement that "оба могут управлять".
//
// Anti-abuse design for uploads / overrides is unchanged from the
// worker: see /rooms/:id/stream/:source/:rawId in routes/rooms.go.

const (
	roomInactivityWindow = 6 * time.Hour          // close after 6h idle
	roomPresenceWindow   = 45 * time.Second       // member is "live" if seen <45s ago
	chatMaxLen           = 1000
	chatMinIntervalMs    = 600
)

// codeAlphabet is the Crockford-ish join-code alphabet — skips I/O/0/1
// to keep mis-typed codes rare. 6 chars over 32 symbols ≈ 1.07B codes.
const codeAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

// RoomTrackSnapshot is the host's currently-playing track as embedded
// in the room state row. Mirrors `RoomTrackSnapshot` in the worker.
type RoomTrackSnapshot struct {
	ID            string             `json:"id"`
	Title         string             `json:"title"`
	Artist        string             `json:"artist"`
	ArtistID      *string            `json:"artistId,omitempty"`
	Artists       []RoomTrackArtist  `json:"artists,omitempty"`
	Album         *string            `json:"album,omitempty"`
	AlbumID       *string            `json:"albumId,omitempty"`
	CoverURL      *string            `json:"coverUrl,omitempty"`
	CoverVideoURL *string            `json:"coverVideoUrl,omitempty"`
	Duration      int                `json:"duration"`
	Source        string             `json:"source"`
	Explicit      *bool              `json:"explicit,omitempty"`
}

// RoomTrackArtist is the per-artist slot inside RoomTrackSnapshot.Artists.
type RoomTrackArtist struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// RoomRow mirrors `listening_rooms`.
type RoomRow struct {
	ID              string `json:"id"`
	Code            string `json:"code"`
	HostID          string `json:"hostId"`
	Name            string `json:"name"`
	Status          string `json:"status"` // 'active' | 'closed'
	CreatedAt       int64  `json:"createdAt"`
	UpdatedAt       int64  `json:"updatedAt"`
	LastActivityAt  int64  `json:"lastActivityAt"`
	HostOnlyControl int    `json:"-"` // 0|1, surfaced as bool elsewhere
}

// RoomStateRow mirrors `listening_room_state`.
type RoomStateRow struct {
	RoomID       string
	TrackJSON    sql.NullString
	TrackID      sql.NullString
	TrackSource  sql.NullString
	StartedAtMs  int64
	PositionMs   int64
	IsPaused     int
	ControllerID sql.NullString
	Version      int64
	UpdatedAtMs  int64
}

// RoomMember is the public-shape per-member row used in /detail and /state.
type RoomMember struct {
	UserID     string  `json:"userId"`
	Username   *string `json:"username"`
	Name       *string `json:"name"`
	Role       string  `json:"role"` // 'host' | 'member'
	JoinedAt   int64   `json:"joinedAt"`
	LastSeenMs int64   `json:"lastSeenMs"`
	IsLive     bool    `json:"isLive"`
}

// RoomState is the public-shape projection of `listening_room_state`.
type RoomState struct {
	Version      int64              `json:"version"`
	IsPaused     bool               `json:"isPaused"`
	PositionMs   int64              `json:"positionMs"`
	StartedAtMs  int64              `json:"startedAtMs"`
	UpdatedAtMs  int64              `json:"updatedAtMs"`
	ControllerID *string            `json:"controllerId"`
	Track        *RoomTrackSnapshot `json:"track"`
}

// RoomDetail is the response shape for create / join / detail. Mirrors
// the TS RoomDetail.
type RoomDetail struct {
	ID              string       `json:"id"`
	Code            string       `json:"code"`
	Name            string       `json:"name"`
	HostID          string       `json:"hostId"`
	Status          string       `json:"status"`
	CreatedAt       int64        `json:"createdAt"`
	HostOnlyControl bool         `json:"hostOnlyControl"`
	State           RoomState    `json:"state"`
	Members         []RoomMember `json:"members"`
	ServerNowMs     int64        `json:"serverNowMs"`
}

// RoomMessage is the public chat-message shape returned by /chat.
type RoomMessage struct {
	ID          int64   `json:"id"`
	UserID      string  `json:"userId"`
	Username    *string `json:"username"`
	Name        *string `json:"name"`
	Body        string  `json:"body"`
	CreatedAtMs int64   `json:"createdAtMs"`
}

// RoomControl is the discriminated-union input to ApplyControl. Kept
// flat (vs sealed interfaces) because every field is optional anyway
// and the route handler decodes straight into this struct.
type RoomControl struct {
	Kind       string             // play|pause|seek|track
	PositionMs *int64             // pause+seek+track
	IsPaused   *bool              // track
	Track      *RoomTrackSnapshot // track
}

// RoomError is the typed error returned by the service when the
// handler should surface a specific HTTP status. Mirrors the
// `(err as { status?: number }).status` shim in the worker.
type RoomError struct {
	Status  int
	Message string
}

func (e *RoomError) Error() string { return e.Message }

func roomErr(status int, msg string) error { return &RoomError{Status: status, Message: msg} }

// ---- helpers -----------------------------------------------------------

func nowMs() int64 { return time.Now().UnixMilli() }

func generateRoomCode() string {
	buf := make([]byte, 6)
	if _, err := rand.Read(buf); err != nil {
		// Fall back to a time-derived seed only if /dev/urandom is
		// utterly broken. Even in that case the worst outcome is
		// retrying CreateRoom up to 8 times on a unique-collision.
		now := uint64(time.Now().UnixNano())
		for i := range buf {
			buf[i] = byte(now >> uint(8*i))
		}
	}
	out := make([]byte, 6)
	for i, b := range buf {
		out[i] = codeAlphabet[int(b)%len(codeAlphabet)]
	}
	return string(out)
}

func parseTrackJSON(raw sql.NullString) *RoomTrackSnapshot {
	if !raw.Valid || raw.String == "" {
		return nil
	}
	var t RoomTrackSnapshot
	if err := json.Unmarshal([]byte(raw.String), &t); err != nil {
		return nil
	}
	return &t
}

func clampNonNegative(n int64) int64 {
	if n < 0 || n != n /* NaN cannot happen on int64 but keep symmetry */ {
		return 0
	}
	return n
}

// sanitiseTrack mirrors `sanitiseTrack` in the worker. The shape
// reaches D1's listening_room_state.track_json and gets re-broadcast
// to every poll; clamping prevents an attacker from poisoning the row
// with megabytes of markup.
func sanitiseTrack(t *RoomTrackSnapshot) *RoomTrackSnapshot {
	if t == nil {
		return nil
	}
	str := func(s string, max int) string {
		if len(s) > max {
			return s[:max]
		}
		return s
	}
	const maxCoverURLLen = 400 * 1024
	out := &RoomTrackSnapshot{
		ID:       str(t.ID, 200),
		Title:    str(t.Title, 300),
		Artist:   str(t.Artist, 300),
		Duration: int(math.Max(0, math.Floor(float64(t.Duration)))),
		Source:   strOrDefault(str(t.Source, 32), "tidal"),
		Explicit: t.Explicit,
	}
	if t.ArtistID != nil {
		v := str(*t.ArtistID, 200)
		out.ArtistID = &v
	}
	if t.Album != nil {
		v := str(*t.Album, 300)
		out.Album = &v
	}
	if t.AlbumID != nil {
		v := str(*t.AlbumID, 200)
		out.AlbumID = &v
	}
	if t.CoverURL != nil {
		v := str(*t.CoverURL, maxCoverURLLen)
		out.CoverURL = &v
	}
	if t.CoverVideoURL != nil {
		v := str(*t.CoverVideoURL, maxCoverURLLen)
		out.CoverVideoURL = &v
	}
	if t.Artists != nil {
		cap := t.Artists
		if len(cap) > 16 {
			cap = cap[:16]
		}
		arr := make([]RoomTrackArtist, 0, len(cap))
		for _, a := range cap {
			arr = append(arr, RoomTrackArtist{ID: str(a.ID, 200), Name: str(a.Name, 300)})
		}
		out.Artists = arr
	}
	return out
}

func strOrDefault(s, def string) string {
	if s == "" {
		return def
	}
	return s
}

// ---- methods -----------------------------------------------------------

// CreateRoom mints a fresh room with `hostID` as the host and seeds
// the state + host-membership rows in the same transaction so a
// subsequent /detail sees a consistent picture.
func (s *RoomService) CreateRoom(ctx context.Context, hostID, name string) (*RoomRow, error) {
	cleanName := strings.TrimSpace(name)
	if cleanName == "" {
		cleanName = "Комната совместного прослушивания"
	}
	if len(cleanName) > 80 {
		cleanName = cleanName[:80]
	}
	id := uuid.NewString()
	now := time.Now().Unix()
	for attempt := 0; attempt < 8; attempt++ {
		code := generateRoomCode()
		err := s.txCreateRoom(ctx, id, code, hostID, cleanName, now)
		if err == nil {
			return &RoomRow{
				ID: id, Code: code, HostID: hostID, Name: cleanName, Status: "active",
				CreatedAt: now, UpdatedAt: now, LastActivityAt: now,
				HostOnlyControl: 0,
			}, nil
		}
		if !isUniqueViolation(err) {
			return nil, err
		}
		// fall through, regenerate code
	}
	return nil, errors.New("не удалось сгенерировать код комнаты")
}

// txCreateRoom wraps the three insert statements in a single
// transaction so a later poll sees a consistent picture even if the
// process dies between the room and state writes.
func (s *RoomService) txCreateRoom(ctx context.Context, id, code, hostID, name string, now int64) error {
	tx, err := s.A.DB.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx) //nolint:errcheck // best-effort if Commit ran
	if _, err := tx.Exec(ctx,
		`INSERT INTO listening_rooms
		   (id, code, host_id, name, status, created_at, updated_at, last_activity_at, host_only_control)
		 VALUES ($1, $2, $3, $4, 'active', $5, $5, $5, 0)`,
		id, code, hostID, name, now,
	); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx,
		`INSERT INTO listening_room_state
		   (room_id, started_at_ms, position_ms, is_paused, version, updated_at_ms)
		 VALUES ($1, 0, 0, 1, 0, $2)`,
		id, nowMs(),
	); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx,
		`INSERT INTO listening_room_members
		   (room_id, user_id, role, joined_at, last_seen_ms)
		 VALUES ($1, $2, 'host', $3, $4)`,
		id, hostID, now, nowMs(),
	); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// isUniqueViolation reports whether the underlying error is a Postgres
// 23505 unique-constraint violation. The CreateRoom retry loop uses it
// to know when to regenerate the join code vs. surface a hard error.
func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}

// FindByID loads a room by primary key. Returns nil row + nil err for
// "not found" — mirrors the worker's `.first()` semantics.
func (s *RoomService) FindByID(ctx context.Context, id string) (*RoomRow, error) {
	return s.scanRoom(ctx,
		`SELECT id, code, host_id, name, status, created_at, updated_at,
		        last_activity_at, COALESCE(host_only_control, 0)
		 FROM listening_rooms WHERE id = $1`, id)
}

// FindByCode looks up an active or closed room by its 6-char code,
// case-insensitively. Used by /join.
func (s *RoomService) FindByCode(ctx context.Context, code string) (*RoomRow, error) {
	return s.scanRoom(ctx,
		`SELECT id, code, host_id, name, status, created_at, updated_at,
		        last_activity_at, COALESCE(host_only_control, 0)
		 FROM listening_rooms WHERE UPPER(code) = UPPER($1)`, code)
}

func (s *RoomService) scanRoom(ctx context.Context, query, arg string) (*RoomRow, error) {
	var r RoomRow
	err := s.A.DB.QueryRow(ctx, query, arg).Scan(
		&r.ID, &r.Code, &r.HostID, &r.Name, &r.Status,
		&r.CreatedAt, &r.UpdatedAt, &r.LastActivityAt, &r.HostOnlyControl,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &r, nil
}

// GetState loads the live state row for the room. Returns nil for
// "not found" (mirrors `.first()` semantics).
func (s *RoomService) GetState(ctx context.Context, roomID string) (*RoomStateRow, error) {
	var r RoomStateRow
	err := s.A.DB.QueryRow(ctx,
		`SELECT room_id, track_json, track_id, track_source,
		        started_at_ms, position_ms, is_paused, controller_id,
		        version, updated_at_ms
		 FROM listening_room_state WHERE room_id = $1`, roomID,
	).Scan(
		&r.RoomID, &r.TrackJSON, &r.TrackID, &r.TrackSource,
		&r.StartedAtMs, &r.PositionMs, &r.IsPaused, &r.ControllerID,
		&r.Version, &r.UpdatedAtMs,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &r, nil
}

// ListMyRooms returns active rooms the user is a member of, most
// recently active first.
func (s *RoomService) ListMyRooms(ctx context.Context, userID string) ([]*RoomRow, error) {
	rows, err := s.A.DB.Query(ctx,
		`SELECT r.id, r.code, r.host_id, r.name, r.status,
		        r.created_at, r.updated_at, r.last_activity_at,
		        COALESCE(r.host_only_control, 0)
		 FROM listening_rooms r
		 INNER JOIN listening_room_members m ON m.room_id = r.id
		 WHERE m.user_id = $1 AND r.status = 'active'
		 ORDER BY r.last_activity_at DESC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*RoomRow
	for rows.Next() {
		var r RoomRow
		if err := rows.Scan(&r.ID, &r.Code, &r.HostID, &r.Name, &r.Status,
			&r.CreatedAt, &r.UpdatedAt, &r.LastActivityAt, &r.HostOnlyControl); err != nil {
			return nil, err
		}
		out = append(out, &r)
	}
	return out, rows.Err()
}

// ListMembers returns the public-shape rows for everyone in the room,
// joined with `users` for display info. `IsLive` is computed against
// the 45-second presence window.
func (s *RoomService) ListMembers(ctx context.Context, roomID string) ([]RoomMember, error) {
	rows, err := s.A.DB.Query(ctx,
		`SELECT m.user_id, m.role, m.joined_at, m.last_seen_ms,
		        u.tg_username, u.tg_name
		 FROM listening_room_members m
		 INNER JOIN users u ON u.id = m.user_id
		 WHERE m.room_id = $1
		 ORDER BY m.joined_at ASC`, roomID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	cutoff := nowMs() - roomPresenceWindow.Milliseconds()
	out := []RoomMember{}
	for rows.Next() {
		var (
			userID   string
			role     string
			joinedAt int64
			lastSeen int64
			username sql.NullString
			name     sql.NullString
		)
		if err := rows.Scan(&userID, &role, &joinedAt, &lastSeen, &username, &name); err != nil {
			return nil, err
		}
		m := RoomMember{
			UserID:     userID,
			Role:       role,
			JoinedAt:   joinedAt,
			LastSeenMs: lastSeen,
			IsLive:     lastSeen >= cutoff,
		}
		if username.Valid {
			v := username.String
			m.Username = &v
		}
		if name.Valid {
			v := name.String
			m.Name = &v
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// IsMember answers the membership gate every authenticated room route
// runs before doing anything else.
func (s *RoomService) IsMember(ctx context.Context, roomID, userID string) (bool, error) {
	var x int
	err := s.A.DB.QueryRow(ctx,
		`SELECT 1 FROM listening_room_members WHERE room_id = $1 AND user_id = $2`,
		roomID, userID,
	).Scan(&x)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return false, nil
		}
		return false, err
	}
	return true, nil
}

// AddMember inserts a member row or refreshes `last_seen_ms` on a
// re-join. Also bumps the room's activity timestamp.
func (s *RoomService) AddMember(ctx context.Context, roomID, userID string) error {
	now := time.Now().Unix()
	_, err := s.A.DB.Exec(ctx,
		`INSERT INTO listening_room_members (room_id, user_id, role, joined_at, last_seen_ms)
		 VALUES ($1, $2, 'member', $3, $4)
		 ON CONFLICT (room_id, user_id) DO UPDATE SET last_seen_ms = EXCLUDED.last_seen_ms`,
		roomID, userID, now, nowMs())
	if err != nil {
		return err
	}
	return s.touchRoom(ctx, roomID)
}

// Heartbeat refreshes the member's `last_seen_ms` so the presence
// window stays open. Called from explicit /heartbeat plus implicitly
// from /detail and /state.
func (s *RoomService) Heartbeat(ctx context.Context, roomID, userID string) error {
	_, err := s.A.DB.Exec(ctx,
		`UPDATE listening_room_members SET last_seen_ms = $1
		 WHERE room_id = $2 AND user_id = $3`,
		nowMs(), roomID, userID)
	return err
}

// RemoveMember removes the user from the room. If the host leaves and
// other members remain, the longest-tenured one is promoted to host;
// otherwise the room is soft-closed.
func (s *RoomService) RemoveMember(ctx context.Context, roomID, userID string) error {
	room, err := s.FindByID(ctx, roomID)
	if err != nil || room == nil {
		return err
	}
	if _, err := s.A.DB.Exec(ctx,
		`DELETE FROM listening_room_members WHERE room_id = $1 AND user_id = $2`,
		roomID, userID); err != nil {
		return err
	}
	if room.HostID == userID {
		var nextID string
		err := s.A.DB.QueryRow(ctx,
			`SELECT user_id FROM listening_room_members
			 WHERE room_id = $1 ORDER BY joined_at ASC LIMIT 1`,
			roomID).Scan(&nextID)
		if err == nil {
			now := time.Now().Unix()
			if _, err := s.A.DB.Exec(ctx,
				`UPDATE listening_rooms SET host_id = $1, updated_at = $2 WHERE id = $3`,
				nextID, now, roomID); err != nil {
				return err
			}
			if _, err := s.A.DB.Exec(ctx,
				`UPDATE listening_room_members SET role = 'host'
				 WHERE room_id = $1 AND user_id = $2`, roomID, nextID); err != nil {
				return err
			}
		} else if errors.Is(err, pgx.ErrNoRows) {
			if err := s.CloseRoom(ctx, roomID); err != nil {
				return err
			}
		} else {
			return err
		}
	}
	return s.touchRoom(ctx, roomID)
}

// CloseRoom soft-closes a room. Used when the host leaves with no one
// left to promote. `DeleteRoom` is hard-delete from the host's
// "удалить руму" button.
func (s *RoomService) CloseRoom(ctx context.Context, roomID string) error {
	_, err := s.A.DB.Exec(ctx,
		`UPDATE listening_rooms SET status = 'closed', updated_at = $1 WHERE id = $2`,
		time.Now().Unix(), roomID)
	return err
}

// DeleteRoom hard-deletes a room. FK ON DELETE CASCADE wipes the
// state, members, and messages in the same write.
func (s *RoomService) DeleteRoom(ctx context.Context, roomID string) error {
	_, err := s.A.DB.Exec(ctx,
		`DELETE FROM listening_rooms WHERE id = $1`, roomID)
	return err
}

func (s *RoomService) touchRoom(ctx context.Context, roomID string) error {
	now := time.Now().Unix()
	_, err := s.A.DB.Exec(ctx,
		`UPDATE listening_rooms SET last_activity_at = $1, updated_at = $1 WHERE id = $2`,
		now, roomID)
	return err
}

// ApplyControl mutates the state row according to `action` and returns
// the new public-shape snapshot the caller can echo to its UI. The
// host-only-control gate fires here on `track`-kind actions.
func (s *RoomService) ApplyControl(ctx context.Context, roomID, userID string, action RoomControl) (*RoomState, error) {
	state, err := s.GetState(ctx, roomID)
	if err != nil {
		return nil, err
	}
	if state == nil {
		return nil, roomErr(404, "Состояние комнаты не найдено")
	}

	// Host-only-control gate. Play/pause/seek stay open to everyone —
	// the spec is "хост хочет чтобы другие не могли ПОСТАВИТЬ трек",
	// which is specifically about track changes.
	if action.Kind == "track" {
		room, err := s.FindByID(ctx, roomID)
		if err != nil {
			return nil, err
		}
		if room != nil && room.HostOnlyControl == 1 && room.HostID != userID {
			return nil, roomErr(403, "Только хост может менять трек в этой комнате")
		}
	}

	now := nowMs()
	track := parseTrackJSON(state.TrackJSON)
	trackID := state.TrackID
	trackSource := state.TrackSource
	isPaused := state.IsPaused == 1
	positionMs := state.PositionMs
	startedAtMs := state.StartedAtMs

	switch action.Kind {
	case "play":
		if isPaused {
			startedAtMs = now
			isPaused = false
		}
	case "pause":
		if !isPaused {
			// Freeze the position at "now" relative to the running span.
			positionMs = clampNonNegative(positionMs + (now - startedAtMs))
			isPaused = true
		} else if action.PositionMs != nil {
			positionMs = clampNonNegative(*action.PositionMs)
		}
	case "seek":
		if action.PositionMs == nil {
			return nil, roomErr(400, "positionMs обязателен")
		}
		positionMs = clampNonNegative(*action.PositionMs)
		if !isPaused {
			startedAtMs = now
		}
	case "track":
		if action.Track == nil {
			return nil, roomErr(400, "track обязателен")
		}
		track = sanitiseTrack(action.Track)
		trackID = sql.NullString{String: track.ID, Valid: true}
		trackSource = sql.NullString{String: track.Source, Valid: true}
		if action.PositionMs != nil {
			positionMs = clampNonNegative(*action.PositionMs)
		} else {
			positionMs = 0
		}
		if action.IsPaused != nil {
			isPaused = *action.IsPaused
		} else {
			isPaused = false
		}
		startedAtMs = now
	default:
		return nil, roomErr(400, fmt.Sprintf("Неизвестный kind: %s", action.Kind))
	}

	newVersion := state.Version + 1
	var trackJSON sql.NullString
	if track != nil {
		b, err := json.Marshal(track)
		if err != nil {
			return nil, err
		}
		trackJSON = sql.NullString{String: string(b), Valid: true}
	}
	pausedInt := 0
	if isPaused {
		pausedInt = 1
	}
	if _, err := s.A.DB.Exec(ctx,
		`UPDATE listening_room_state
		   SET track_json = $1, track_id = $2, track_source = $3,
		       started_at_ms = $4, position_ms = $5, is_paused = $6,
		       controller_id = $7, version = $8, updated_at_ms = $9
		 WHERE room_id = $10`,
		trackJSON, trackID, trackSource,
		startedAtMs, positionMs, pausedInt,
		userID, newVersion, now, roomID,
	); err != nil {
		return nil, err
	}
	if err := s.touchRoom(ctx, roomID); err != nil {
		return nil, err
	}
	uid := userID
	return &RoomState{
		Version:      newVersion,
		IsPaused:     isPaused,
		PositionMs:   positionMs,
		StartedAtMs:  startedAtMs,
		UpdatedAtMs:  now,
		ControllerID: &uid,
		Track:        track,
	}, nil
}

// ToRoomState projects a raw state row into its public shape.
func (s *RoomService) ToRoomState(row *RoomStateRow) RoomState {
	var ctrl *string
	if row.ControllerID.Valid {
		v := row.ControllerID.String
		ctrl = &v
	}
	return RoomState{
		Version:      row.Version,
		IsPaused:     row.IsPaused == 1,
		PositionMs:   row.PositionMs,
		StartedAtMs:  row.StartedAtMs,
		UpdatedAtMs:  row.UpdatedAtMs,
		ControllerID: ctrl,
		Track:        parseTrackJSON(row.TrackJSON),
	}
}

// Detail builds the unified payload returned by /:id (and by /create,
// /join). Pulls state + members in parallel-equivalent calls.
func (s *RoomService) Detail(ctx context.Context, room *RoomRow) (*RoomDetail, error) {
	state, err := s.GetState(ctx, room.ID)
	if err != nil {
		return nil, err
	}
	members, err := s.ListMembers(ctx, room.ID)
	if err != nil {
		return nil, err
	}
	var rs RoomState
	if state != nil {
		rs = s.ToRoomState(state)
	} else {
		rs = emptyRoomState()
	}
	return &RoomDetail{
		ID:              room.ID,
		Code:            room.Code,
		Name:            room.Name,
		HostID:          room.HostID,
		Status:          room.Status,
		CreatedAt:       room.CreatedAt,
		HostOnlyControl: room.HostOnlyControl == 1,
		State:           rs,
		Members:         members,
		ServerNowMs:     nowMs(),
	}, nil
}

func emptyRoomState() RoomState {
	return RoomState{
		Version:     0,
		IsPaused:    true,
		PositionMs:  0,
		StartedAtMs: 0,
		UpdatedAtMs: 0,
	}
}

// AppendMessage trims, length-clamps and rate-limits the chat body
// before inserting and returns the canonical row joined with author
// display fields. The 600 ms per-user cooldown matches the worker.
func (s *RoomService) AppendMessage(ctx context.Context, roomID, userID, rawBody string) (*RoomMessage, error) {
	body := strings.TrimSpace(rawBody)
	if body == "" {
		return nil, roomErr(400, "Сообщение не может быть пустым")
	}
	if len(body) > chatMaxLen {
		body = body[:chatMaxLen]
	}
	var lastMs int64
	err := s.A.DB.QueryRow(ctx,
		`SELECT created_at_ms FROM listening_room_messages
		 WHERE room_id = $1 AND user_id = $2
		 ORDER BY id DESC LIMIT 1`,
		roomID, userID).Scan(&lastMs)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return nil, err
	}
	now := nowMs()
	if lastMs > 0 && now-lastMs < chatMinIntervalMs {
		return nil, roomErr(429, "Слишком часто. Подожди секунду.")
	}
	var insertedID int64
	if err := s.A.DB.QueryRow(ctx,
		`INSERT INTO listening_room_messages (room_id, user_id, body, created_at_ms)
		 VALUES ($1, $2, $3, $4) RETURNING id`,
		roomID, userID, body, now,
	).Scan(&insertedID); err != nil {
		return nil, err
	}
	_ = s.touchRoom(ctx, roomID)
	var username, name sql.NullString
	_ = s.A.DB.QueryRow(ctx,
		`SELECT tg_username, tg_name FROM users WHERE id = $1`, userID,
	).Scan(&username, &name)
	msg := &RoomMessage{
		ID:          insertedID,
		UserID:      userID,
		Body:        body,
		CreatedAtMs: now,
	}
	if username.Valid {
		v := username.String
		msg.Username = &v
	}
	if name.Valid {
		v := name.String
		msg.Name = &v
	}
	return msg, nil
}

// ListRecentMessages returns the most-recent ~100 messages in
// ascending order. Used by the initial chat render.
func (s *RoomService) ListRecentMessages(ctx context.Context, roomID string, limit int) ([]RoomMessage, error) {
	if limit <= 0 {
		limit = 100
	}
	if limit > 200 {
		limit = 200
	}
	rows, err := s.A.DB.Query(ctx,
		`SELECT m.id, m.user_id, m.body, m.created_at_ms,
		        u.tg_username, u.tg_name
		 FROM listening_room_messages m
		 INNER JOIN users u ON u.id = m.user_id
		 WHERE m.room_id = $1
		 ORDER BY m.id DESC
		 LIMIT $2`, roomID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []RoomMessage{}
	for rows.Next() {
		m, err := scanMessage(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	// Reverse so callers get ascending order.
	for i, j := 0, len(out)-1; i < j; i, j = i+1, j-1 {
		out[i], out[j] = out[j], out[i]
	}
	return out, rows.Err()
}

// ListMessagesSince returns every message strictly newer than
// `sinceID`. Used by the polling cursor.
func (s *RoomService) ListMessagesSince(ctx context.Context, roomID string, sinceID int64) ([]RoomMessage, error) {
	if sinceID < 0 {
		sinceID = 0
	}
	rows, err := s.A.DB.Query(ctx,
		`SELECT m.id, m.user_id, m.body, m.created_at_ms,
		        u.tg_username, u.tg_name
		 FROM listening_room_messages m
		 INNER JOIN users u ON u.id = m.user_id
		 WHERE m.room_id = $1 AND m.id > $2
		 ORDER BY m.id ASC
		 LIMIT 200`, roomID, sinceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []RoomMessage{}
	for rows.Next() {
		m, err := scanMessage(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// SetHostOnlyControl flips the room's "только хост ставит треки" toggle.
// Caller is expected to have verified hostID == room.host_id; we still
// double-check here so the service can be reused from a non-route
// caller without re-implementing the gate.
func (s *RoomService) SetHostOnlyControl(ctx context.Context, roomID, hostID string, value bool) error {
	room, err := s.FindByID(ctx, roomID)
	if err != nil {
		return err
	}
	if room == nil {
		return roomErr(404, "Комната не найдена")
	}
	if room.HostID != hostID {
		return roomErr(403, "Только хост может менять настройки")
	}
	flag := 0
	if value {
		flag = 1
	}
	now := time.Now().Unix()
	if _, err := s.A.DB.Exec(ctx,
		`UPDATE listening_rooms SET host_only_control = $1, updated_at = $2 WHERE id = $3`,
		flag, now, roomID); err != nil {
		return err
	}
	// Bump the state version so all members see the toggle change on
	// their next /state poll without re-fetching /detail.
	if _, err := s.A.DB.Exec(ctx,
		`UPDATE listening_room_state SET version = version + 1, updated_at_ms = $1 WHERE room_id = $2`,
		nowMs(), roomID); err != nil {
		return err
	}
	return s.touchRoom(ctx, roomID)
}

// GCRooms is the cron sweep — soft-closes rooms idle past the 6h
// window. Returns the affected count for the cron summary log.
func (s *RoomService) GCRooms(ctx context.Context) (int64, error) {
	cutoff := time.Now().Add(-roomInactivityWindow).Unix()
	res, err := s.A.DB.Exec(ctx,
		`UPDATE listening_rooms SET status = 'closed', updated_at = $1
		 WHERE status = 'active' AND last_activity_at < $2`,
		time.Now().Unix(), cutoff)
	if err != nil {
		return 0, err
	}
	return res.RowsAffected(), nil
}

// scanMessage decodes one chat row + author join into a RoomMessage.
// Used by both ListRecentMessages and ListMessagesSince.
func scanMessage(rows pgx.Rows) (RoomMessage, error) {
	var (
		id           int64
		userID, body string
		createdAtMs  int64
		username     sql.NullString
		name         sql.NullString
	)
	if err := rows.Scan(&id, &userID, &body, &createdAtMs, &username, &name); err != nil {
		return RoomMessage{}, err
	}
	m := RoomMessage{
		ID:          id,
		UserID:      userID,
		Body:        body,
		CreatedAtMs: createdAtMs,
	}
	if username.Valid {
		v := username.String
		m.Username = &v
	}
	if name.Valid {
		v := name.String
		m.Name = &v
	}
	return m, nil
}
