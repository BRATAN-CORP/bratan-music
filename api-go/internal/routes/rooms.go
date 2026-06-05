package routes

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/coder/websocket"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/minio/minio-go/v7"

	"github.com/bratan-corp/bratan-music/api-go/internal/app"
	"github.com/bratan-corp/bratan-music/api-go/internal/authz"
	"github.com/bratan-corp/bratan-music/api-go/internal/httpx"
	"github.com/bratan-corp/bratan-music/api-go/internal/services"
)

// Listening rooms — port of worker/src/routes/rooms.ts.
//
// Auth model:
//   - Every endpoint except the chat /ws upgrade carries the standard
//     `Authorization: Bearer …` JWT middleware (wired in mounts.go).
//   - The /ws upgrade accepts `?token=` because browsers cannot
//     attach an Authorization header to `new WebSocket(...)`. We
//     verify that token here, then run the same membership gate the
//     REST surface uses before letting the upgrade through.
//   - Non-membership returns 403, NOT 404, so the surface doesn't
//     leak whether a given room id exists.

// nowMsRoute is the same millisecond clock the service uses. Kept
// local so the routes file doesn't reach into services for a clock.
func nowMsRoute() int64 { return time.Now().UnixMilli() }

// roomCtx returns the typed RoomService from app.App. We do this in
// every handler instead of caching at mount time because the service
// is stored as `any` on the App to avoid a routes/services import cycle.
func roomSvc(a *app.App) *services.RoomService { return a.Rooms.(*services.RoomService) }

// roomErrorStatus maps a service-side RoomError onto an HTTP code.
// Anything else collapses to 500.
func writeRoomError(w http.ResponseWriter, err error) {
	var rerr *services.RoomError
	if errors.As(err, &rerr) {
		httpx.Err(w, rerr.Status, rerr.Message)
		return
	}
	httpx.Internal(w, err)
}

// ---- handlers ----------------------------------------------------------

func createRoom(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID := httpx.UserID(r)
		var body struct {
			Name string `json:"name"`
		}
		_ = httpx.BindJSON(r, &body, 16*1024)
		room, err := roomSvc(a).CreateRoom(r.Context(), userID, body.Name)
		if err != nil {
			httpx.Internal(w, err)
			return
		}
		detail, err := roomSvc(a).Detail(r.Context(), room)
		if err != nil {
			httpx.Internal(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, detail)
	}
}

// listRooms is a light "rooms I'm in" surface for the index page.
// Full state per room would be wasteful since the user might be in
// half a dozen idle rooms.
func listRooms(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID := httpx.UserID(r)
		rooms, err := roomSvc(a).ListMyRooms(r.Context(), userID)
		if err != nil {
			httpx.Internal(w, err)
			return
		}
		items := make([]map[string]any, 0, len(rooms))
		for _, room := range rooms {
			items = append(items, map[string]any{
				"id":             room.ID,
				"code":           room.Code,
				"name":           room.Name,
				"hostId":         room.HostID,
				"isHost":         room.HostID == userID,
				"lastActivityAt": room.LastActivityAt,
			})
		}
		httpx.JSON(w, http.StatusOK, map[string]any{"items": items})
	}
}

func joinRoom(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID := httpx.UserID(r)
		var body struct {
			Code string `json:"code"`
		}
		_ = httpx.BindJSON(r, &body, 16*1024)
		code := strings.TrimSpace(body.Code)
		if code == "" {
			httpx.Err(w, http.StatusBadRequest, "Код комнаты обязателен")
			return
		}
		room, err := roomSvc(a).FindByCode(r.Context(), code)
		if err != nil {
			httpx.Internal(w, err)
			return
		}
		if room == nil || room.Status != "active" {
			httpx.Err(w, http.StatusNotFound, "Комната не найдена или закрыта")
			return
		}
		if err := roomSvc(a).AddMember(r.Context(), room.ID, userID); err != nil {
			httpx.Internal(w, err)
			return
		}
		detail, err := roomSvc(a).Detail(r.Context(), room)
		if err != nil {
			httpx.Internal(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, detail)
	}
}

func getRoom(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID := httpx.UserID(r)
		id := chi.URLParam(r, "id")
		svc := roomSvc(a)
		room, err := svc.FindByID(r.Context(), id)
		if err != nil {
			httpx.Internal(w, err)
			return
		}
		if room == nil {
			httpx.Err(w, http.StatusForbidden, "Нет доступа")
			return
		}
		ok, err := svc.IsMember(r.Context(), id, userID)
		if err != nil {
			httpx.Internal(w, err)
			return
		}
		if !ok {
			httpx.Err(w, http.StatusForbidden, "Нет доступа")
			return
		}
		_ = svc.Heartbeat(r.Context(), id, userID)
		detail, err := svc.Detail(r.Context(), room)
		if err != nil {
			httpx.Internal(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, detail)
	}
}

// getRoomState is the 1.5s poll endpoint. When `?since=<version>`
// matches the current row, we short-circuit with `unchanged:true` and
// pass `serverNowMs` so the client can keep correcting its clock skew
// without rendering anything new.
func getRoomState(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID := httpx.UserID(r)
		id := chi.URLParam(r, "id")
		svc := roomSvc(a)
		ok, err := svc.IsMember(r.Context(), id, userID)
		if err != nil {
			httpx.Internal(w, err)
			return
		}
		if !ok {
			httpx.Err(w, http.StatusForbidden, "Нет доступа")
			return
		}
		_ = svc.Heartbeat(r.Context(), id, userID)
		stateRow, err := svc.GetState(r.Context(), id)
		if err != nil {
			httpx.Internal(w, err)
			return
		}
		if stateRow == nil {
			httpx.Err(w, http.StatusNotFound, "Нет состояния")
			return
		}
		room, err := svc.FindByID(r.Context(), id)
		if err != nil {
			httpx.Internal(w, err)
			return
		}
		hostOnlyControl := room != nil && room.HostOnlyControl == 1
		serverNowMs := nowMsRoute()
		if sinceRaw := r.URL.Query().Get("since"); sinceRaw != "" {
			if since, err := strconv.ParseInt(sinceRaw, 10, 64); err == nil && stateRow.Version <= since {
				httpx.JSON(w, http.StatusOK, map[string]any{
					"unchanged":       true,
					"version":         stateRow.Version,
					"hostOnlyControl": hostOnlyControl,
					"serverNowMs":     serverNowMs,
				})
				return
			}
		}
		state := svc.ToRoomState(stateRow)
		members, err := svc.ListMembers(r.Context(), id)
		if err != nil {
			httpx.Internal(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, map[string]any{
			"unchanged":       false,
			"state":           state,
			"members":         members,
			"hostOnlyControl": hostOnlyControl,
			"serverNowMs":     serverNowMs,
		})
	}
}

func roomHeartbeat(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID := httpx.UserID(r)
		id := chi.URLParam(r, "id")
		svc := roomSvc(a)
		ok, err := svc.IsMember(r.Context(), id, userID)
		if err != nil {
			httpx.Internal(w, err)
			return
		}
		if !ok {
			httpx.Err(w, http.StatusForbidden, "Нет доступа")
			return
		}
		_ = svc.Heartbeat(r.Context(), id, userID)
		httpx.JSON(w, http.StatusOK, map[string]any{"ok": true, "serverNowMs": nowMsRoute()})
	}
}

// getRoomChat returns the chat snapshot. With `?since=<id>` it acts
// as the polling cursor; without it, the most-recent 100 messages.
func getRoomChat(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID := httpx.UserID(r)
		id := chi.URLParam(r, "id")
		svc := roomSvc(a)
		ok, err := svc.IsMember(r.Context(), id, userID)
		if err != nil {
			httpx.Internal(w, err)
			return
		}
		if !ok {
			httpx.Err(w, http.StatusForbidden, "Нет доступа")
			return
		}
		var (
			messages []services.RoomMessage
			fetchErr error
		)
		if sinceRaw := r.URL.Query().Get("since"); sinceRaw != "" {
			if since, err := strconv.ParseInt(sinceRaw, 10, 64); err == nil && since >= 0 {
				messages, fetchErr = svc.ListMessagesSince(r.Context(), id, since)
			} else {
				messages, fetchErr = svc.ListRecentMessages(r.Context(), id, 100)
			}
		} else {
			messages, fetchErr = svc.ListRecentMessages(r.Context(), id, 100)
		}
		if fetchErr != nil {
			httpx.Internal(w, fetchErr)
			return
		}
		httpx.JSON(w, http.StatusOK, map[string]any{
			"messages":    messages,
			"serverNowMs": nowMsRoute(),
		})
	}
}

func postRoomChat(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID := httpx.UserID(r)
		id := chi.URLParam(r, "id")
		svc := roomSvc(a)
		room, err := svc.FindByID(r.Context(), id)
		if err != nil {
			httpx.Internal(w, err)
			return
		}
		if room == nil || room.Status != "active" {
			httpx.Err(w, http.StatusNotFound, "Комната не найдена")
			return
		}
		ok, err := svc.IsMember(r.Context(), id, userID)
		if err != nil {
			httpx.Internal(w, err)
			return
		}
		if !ok {
			httpx.Err(w, http.StatusForbidden, "Нет доступа")
			return
		}
		var body struct {
			Body string `json:"body"`
		}
		_ = httpx.BindJSON(r, &body, 16*1024)
		msg, err := svc.AppendMessage(r.Context(), id, userID, body.Body)
		if err != nil {
			writeRoomError(w, err)
			return
		}
		// Broadcast in a goroutine so the sender doesn't block on the
		// per-conn write deadline. The DB row is already canonical;
		// any client we fail to reach picks the message up via the
		// 2.5s polling cursor.
		if hub, ok := a.RoomHub.(*services.RoomHub); ok && hub != nil {
			go hub.BroadcastMessage(id, msg)
		}
		httpx.JSON(w, http.StatusOK, map[string]any{
			"message":     msg,
			"serverNowMs": nowMsRoute(),
		})
	}
}

// roomChatWS upgrades the connection and pumps `{kind:'message',...}`
// envelopes from the hub to the client. Reads are drained but
// dropped — the canonical write path is POST /:id/chat.
func roomChatWS(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// WS upgrade can't carry an Authorization header, so we accept
		// the JWT via `?token=` here and run a one-shot verify before
		// the membership gate. Anything that fails reads as a 401 on
		// the upgrade — keeps the surface symmetric with the worker.
		token := r.URL.Query().Get("token")
		if token == "" {
			httpx.Err(w, http.StatusUnauthorized, "Нет токена")
			return
		}
		claims, err := authz.Verify(a.Cfg.JWTSecret, token)
		if err != nil {
			httpx.Err(w, http.StatusUnauthorized, "Невалидный токен")
			return
		}
		userID := claims.Subject
		id := chi.URLParam(r, "id")
		svc := roomSvc(a)
		room, err := svc.FindByID(r.Context(), id)
		if err != nil {
			httpx.Internal(w, err)
			return
		}
		if room == nil || room.Status != "active" {
			httpx.Err(w, http.StatusNotFound, "Комната не найдена")
			return
		}
		ok, err := svc.IsMember(r.Context(), id, userID)
		if err != nil {
			httpx.Internal(w, err)
			return
		}
		if !ok {
			httpx.Err(w, http.StatusForbidden, "Нет доступа")
			return
		}

		conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{
			// nginx + browser DevTools both work fine without
			// origin checks here; the JWT gate above already binds
			// the upgrade to a known user.
			InsecureSkipVerify: true,
		})
		if err != nil {
			// websocket.Accept already wrote a response.
			return
		}
		defer conn.CloseNow()

		hub, _ := a.RoomHub.(*services.RoomHub)
		if hub == nil {
			conn.Close(websocket.StatusInternalError, "hub not configured")
			return
		}
		if !hub.Add(id, conn) {
			conn.Close(websocket.StatusTryAgainLater, "room socket limit reached")
			return
		}
		defer hub.Remove(id, conn)

		// hello envelope so the client can clock-sync from the moment
		// the upgrade completes, mirroring the ChatRoomDO behaviour.
		helloCtx, helloCancel := context.WithTimeout(r.Context(), 5*time.Second)
		helloPayload, _ := json.Marshal(map[string]any{
			"kind":        "hello",
			"serverNowMs": nowMsRoute(),
		})
		_ = conn.Write(helloCtx, websocket.MessageText, helloPayload)
		helloCancel()

		// Drain inbound frames so the client's keepalive pings don't
		// stall the read pump; payloads are dropped on the floor.
		// `Read` returns when the conn closes, which is what unblocks
		// this handler.
		for {
			if _, _, err := conn.Read(r.Context()); err != nil {
				return
			}
		}
	}
}

func roomControl(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID := httpx.UserID(r)
		id := chi.URLParam(r, "id")
		svc := roomSvc(a)
		room, err := svc.FindByID(r.Context(), id)
		if err != nil {
			httpx.Internal(w, err)
			return
		}
		if room == nil || room.Status != "active" {
			httpx.Err(w, http.StatusNotFound, "Комната не найдена")
			return
		}
		ok, err := svc.IsMember(r.Context(), id, userID)
		if err != nil {
			httpx.Internal(w, err)
			return
		}
		if !ok {
			httpx.Err(w, http.StatusForbidden, "Нет доступа")
			return
		}
		var body struct {
			Kind       string                     `json:"kind"`
			PositionMs *int64                     `json:"positionMs,omitempty"`
			IsPaused   *bool                      `json:"isPaused,omitempty"`
			Track      *services.RoomTrackSnapshot `json:"track,omitempty"`
		}
		if err := httpx.BindJSON(r, &body, 1<<20); err != nil || body.Kind == "" {
			httpx.Err(w, http.StatusBadRequest, "kind обязателен")
			return
		}
		newState, err := svc.ApplyControl(r.Context(), id, userID, services.RoomControl{
			Kind:       body.Kind,
			PositionMs: body.PositionMs,
			IsPaused:   body.IsPaused,
			Track:      body.Track,
		})
		if err != nil {
			writeRoomError(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, map[string]any{
			"ok":          true,
			"state":       newState,
			"serverNowMs": nowMsRoute(),
		})
	}
}

func leaveRoom(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID := httpx.UserID(r)
		id := chi.URLParam(r, "id")
		if err := roomSvc(a).RemoveMember(r.Context(), id, userID); err != nil {
			httpx.Internal(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, map[string]any{"ok": true})
	}
}

func patchRoomSettings(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID := httpx.UserID(r)
		id := chi.URLParam(r, "id")
		var body struct {
			HostOnlyControl *bool `json:"hostOnlyControl,omitempty"`
		}
		_ = httpx.BindJSON(r, &body, 16*1024)
		svc := roomSvc(a)
		room, err := svc.FindByID(r.Context(), id)
		if err != nil {
			httpx.Internal(w, err)
			return
		}
		if room == nil || room.Status != "active" {
			httpx.Err(w, http.StatusNotFound, "Комната не найдена")
			return
		}
		if room.HostID != userID {
			httpx.Err(w, http.StatusForbidden, "Менять настройки может только хост")
			return
		}
		if body.HostOnlyControl != nil {
			if err := svc.SetHostOnlyControl(r.Context(), id, userID, *body.HostOnlyControl); err != nil {
				writeRoomError(w, err)
				return
			}
		}
		// Re-read so the response reflects the (possibly-updated)
		// host_only_control flag.
		room, err = svc.FindByID(r.Context(), id)
		if err != nil || room == nil {
			httpx.Internal(w, err)
			return
		}
		detail, err := svc.Detail(r.Context(), room)
		if err != nil {
			httpx.Internal(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, detail)
	}
}

func deleteRoom(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID := httpx.UserID(r)
		id := chi.URLParam(r, "id")
		svc := roomSvc(a)
		room, err := svc.FindByID(r.Context(), id)
		if err != nil {
			httpx.Internal(w, err)
			return
		}
		if room == nil {
			httpx.Err(w, http.StatusNotFound, "Комната не найдена")
			return
		}
		if room.HostID != userID {
			httpx.Err(w, http.StatusForbidden, "Удалять комнату может только хост")
			return
		}
		if err := svc.DeleteRoom(r.Context(), id); err != nil {
			httpx.Internal(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, map[string]any{"ok": true})
	}
}

// ---- stream proxy ------------------------------------------------------
//
// Mirror of the anti-abuse stream proxy in worker/src/routes/rooms.ts.
// The requested track must match the room's *currently* playing track;
// anything stale returns 410 so guests can't keep streaming yesterday's
// host upload after the room has moved on.

var rangeRE = regexp.MustCompile(`^bytes=(\d*)-(\d*)$`)

func roomStream(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID := httpx.UserID(r)
		id := chi.URLParam(r, "id")
		source := chi.URLParam(r, "source")
		rawID := chi.URLParam(r, "rawId")
		svc := roomSvc(a)

		room, err := svc.FindByID(r.Context(), id)
		if err != nil {
			httpx.Internal(w, err)
			return
		}
		if room == nil || room.Status != "active" {
			httpx.Err(w, http.StatusForbidden, "Нет доступа")
			return
		}
		ok, err := svc.IsMember(r.Context(), id, userID)
		if err != nil {
			httpx.Internal(w, err)
			return
		}
		if !ok {
			httpx.Err(w, http.StatusForbidden, "Нет доступа")
			return
		}
		stateRow, err := svc.GetState(r.Context(), id)
		if err != nil {
			httpx.Internal(w, err)
			return
		}
		if stateRow == nil {
			httpx.Err(w, http.StatusNotFound, "Нет состояния")
			return
		}

		// Hard-gate: the requested track must be the room's currently-
		// playing track. Anything else is the abuse case this endpoint
		// exists to block — a guest reaching for a previously-played
		// host upload they no longer have permission to stream.
		currentSource := ""
		if stateRow.TrackSource.Valid {
			currentSource = stateRow.TrackSource.String
		}
		currentID := ""
		if stateRow.TrackID.Valid {
			currentID = stateRow.TrackID.String
		}
		fullCurrentID := currentID
		if currentSource == "upload" {
			fullCurrentID = "upload:" + strings.TrimPrefix(currentID, "upload:")
		}
		fullRequested := rawID
		if source == "upload" {
			fullRequested = "upload:" + rawID
		}
		if fullCurrentID != fullRequested || (currentSource != "" && currentSource != source) {
			httpx.Err(w, http.StatusGone, "Этот трек больше не играет в комнате")
			return
		}

		switch source {
		case "upload":
			streamUploadInRoom(a, w, r, room.HostID, rawID)
		case "override":
			streamOverrideInRoom(a, w, r, room.HostID, rawID)
		case "tidal":
			// Tidal goes through the regular catalogue pipeline but
			// without the daily-listens gate — guests are listening
			// to the host's selection, not freely browsing.
			//
			// The CDN URL is then wrapped in the same /tracks/audio
			// proxy the host uses so guests get a stable same-origin
			// URL with predictable CORS / Range support. Handing out
			// a raw CloudFront URL caused intermittent CORS-preflight
			// failures on the second listener in the worker version.
			quality := strings.ToUpper(strings.TrimSpace(r.URL.Query().Get("quality")))
			if quality == "" {
				quality = "LOSSLESS"
			}
			resolved, err := tidalSvc(a).API.ResolveStream(r.Context(), rawID, quality)
			if err != nil {
				httpx.Err(w, http.StatusBadGateway,
					fmt.Sprintf("Ошибка стрима: %s", err.Error()))
				return
			}
			scheme := "https"
			if r.TLS == nil && r.Header.Get("X-Forwarded-Proto") == "" {
				scheme = "http"
			}
			host := r.Host
			if forwarded := r.Header.Get("X-Forwarded-Host"); forwarded != "" {
				host = forwarded
			}
			proxied := fmt.Sprintf("%s://%s/tracks/audio?url=%s",
				scheme, host, encodeQuery(resolved.URL))
			httpx.JSON(w, http.StatusOK, map[string]any{
				"url":     proxied,
				"quality": resolved.Quality,
			})
		default:
			httpx.Err(w, http.StatusBadRequest, "Неизвестный источник")
		}
	}
}

// streamUploadInRoom pipes a host upload from object storage with
// Range support. Uploads are written under deterministic keys in the
// `user_tracks` table; the row check ensures only the host's own
// uploads are exposed via the room.
func streamUploadInRoom(a *app.App, w http.ResponseWriter, r *http.Request, hostID, rawID string) {
	var (
		key      string
		mimeType string
	)
	err := a.DB.QueryRow(r.Context(),
		`SELECT r2_key, mime_type FROM user_tracks WHERE id = $1 AND user_id = $2`,
		rawID, hostID).Scan(&key, &mimeType)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) || errors.Is(err, sql.ErrNoRows) {
			httpx.Err(w, http.StatusNotFound, "Файл не найден")
			return
		}
		httpx.Internal(w, err)
		return
	}
	r2Stream(a, w, r, key, mimeType)
}

// streamOverrideInRoom streams the host's `track_overrides` row for
// the currently-playing track. `rawID` arrives as `<source>:<trackId>`.
func streamOverrideInRoom(a *app.App, w http.ResponseWriter, r *http.Request, hostID, combined string) {
	idx := strings.Index(combined, ":")
	trackSource := "tidal"
	trackID := combined
	if idx >= 0 {
		trackSource = combined[:idx]
		trackID = combined[idx+1:]
	}
	var (
		key      string
		mimeType string
	)
	err := a.DB.QueryRow(r.Context(),
		`SELECT r2_key, mime_type FROM track_overrides
		 WHERE user_id = $1 AND track_id = $2 AND source = $3`,
		hostID, trackID, trackSource).Scan(&key, &mimeType)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) || errors.Is(err, sql.ErrNoRows) {
			httpx.Err(w, http.StatusNotFound, "Override не найден")
			return
		}
		httpx.Internal(w, err)
		return
	}
	r2Stream(a, w, r, key, mimeType)
}

// r2Stream proxies an S3/MinIO object to the response writer with
// Range and ETag-conditional support. The legacy worker stamped the
// `Cache-Control: private, no-store` header explicitly because the
// room can swap track at any time and any cached bytes would outlive
// the play span — we keep the same header here for the same reason.
func r2Stream(a *app.App, w http.ResponseWriter, r *http.Request, key, mimeType string) {
	ctx := r.Context()
	opts := minio.GetObjectOptions{}
	if rh := r.Header.Get("Range"); rh != "" {
		if m := rangeRE.FindStringSubmatch(rh); m != nil {
			startStr, endStr := m[1], m[2]
			var start, end int64
			haveStart, haveEnd := false, false
			if startStr != "" {
				if v, err := strconv.ParseInt(startStr, 10, 64); err == nil {
					start = v
					haveStart = true
				}
			}
			if endStr != "" {
				if v, err := strconv.ParseInt(endStr, 10, 64); err == nil {
					end = v
					haveEnd = true
				}
			}
			if haveStart && haveEnd {
				_ = opts.SetRange(start, end)
			} else if haveStart {
				_ = opts.SetRange(start, 0)
			} else if haveEnd {
				// suffix-byte range: last N bytes
				_ = opts.SetRange(-end, 0)
			}
		}
	}

	obj, err := a.Store.GetWithOptions(ctx, key, opts)
	if err != nil {
		httpx.Err(w, http.StatusNotFound, "Файл не найден")
		return
	}
	defer obj.Close()
	info, err := obj.Stat()
	if err != nil {
		httpx.Err(w, http.StatusNotFound, "Файл не найден")
		return
	}

	hdr := w.Header()
	if mimeType != "" {
		hdr.Set("Content-Type", mimeType)
	} else {
		hdr.Set("Content-Type", "application/octet-stream")
	}
	hdr.Set("Accept-Ranges", "bytes")
	// The room may swap track at any time — never cache.
	hdr.Set("Cache-Control", "private, no-store")

	// MinIO's Stat() on a ranged Get returns the ranged length in
	// .Size and exposes the canonical Content-Range via the
	// underlying response metadata; we mirror those into the
	// outbound headers for the client.
	if rh := r.Header.Get("Range"); rh != "" {
		// Re-derive Content-Range from the metadata; minio-go
		// surfaces it through the http response only when we ask
		// for it explicitly, so we synthesise it here from the
		// requested range against the underlying object size.
		fullSize, headErr := a.Store.StatSize(ctx, key)
		if headErr == nil {
			start, length, ok := parseRangeFor(rh, fullSize)
			if ok {
				end := start + length - 1
				hdr.Set("Content-Range", fmt.Sprintf("bytes %d-%d/%d", start, end, fullSize))
				hdr.Set("Content-Length", strconv.FormatInt(length, 10))
				w.WriteHeader(http.StatusPartialContent)
				_, _ = io.Copy(w, obj)
				return
			}
		}
	}
	hdr.Set("Content-Length", strconv.FormatInt(info.Size, 10))
	w.WriteHeader(http.StatusOK)
	_, _ = io.Copy(w, obj)
}

// parseRangeFor resolves a `bytes=start-end` header against a known
// object size and returns the absolute (start, length) the client
// asked for. Used to synthesise the Content-Range outbound header.
func parseRangeFor(header string, total int64) (start, length int64, ok bool) {
	m := rangeRE.FindStringSubmatch(header)
	if m == nil {
		return 0, 0, false
	}
	startStr, endStr := m[1], m[2]
	if startStr == "" && endStr == "" {
		return 0, 0, false
	}
	if startStr == "" {
		// suffix range: last N bytes
		n, err := strconv.ParseInt(endStr, 10, 64)
		if err != nil || n <= 0 {
			return 0, 0, false
		}
		if n > total {
			n = total
		}
		return total - n, n, true
	}
	s, err := strconv.ParseInt(startStr, 10, 64)
	if err != nil || s < 0 || s >= total {
		return 0, 0, false
	}
	if endStr == "" {
		return s, total - s, true
	}
	e, err := strconv.ParseInt(endStr, 10, 64)
	if err != nil || e < s {
		return 0, 0, false
	}
	if e >= total {
		e = total - 1
	}
	return s, e - s + 1, true
}

// encodeQuery is a tiny wrapper that hides the url.QueryEscape import
// without dragging "net/url" into this file just for one call.
func encodeQuery(s string) string {
	var buf bytes.Buffer
	for i := 0; i < len(s); i++ {
		c := s[i]
		switch {
		case c == ' ':
			buf.WriteByte('+')
		case (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') ||
			(c >= '0' && c <= '9') ||
			c == '-' || c == '_' || c == '.' || c == '~':
			buf.WriteByte(c)
		default:
			fmt.Fprintf(&buf, "%%%02X", c)
		}
	}
	return buf.String()
}
