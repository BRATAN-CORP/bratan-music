package routes

import (
	"database/sql"
	"errors"
	"net/http"
	"regexp"
	"strconv"

	"github.com/jackc/pgx/v5"

	"github.com/bratan-corp/bratan-music/api-go/internal/app"
	"github.com/bratan-corp/bratan-music/api-go/internal/httpx"
	"github.com/bratan-corp/bratan-music/api-go/internal/services"
	"github.com/go-chi/chi/v5"
)

// Ported from worker/src/routes/overrides.ts +
// worker/src/services/StorageService.ts. The worker exposed four
// endpoints under `/tracks/:id/override(/stream)`:
//
//   PUT    /tracks/:id/override         — upload a new override
//   DELETE /tracks/:id/override         — drop the override row + R2 object
//   GET    /tracks/:id/override         — { exists, override } status
//   GET    /tracks/:id/override/stream  — stream the bytes with Range support
//
// Storage key shape matches the worker: `overrides/<userId>/<source>/<trackId>`.
// We deliberately keep the slash-bearing key here even though MinIO is
// fine with it — it makes the audit story identical to the legacy
// worker and means existing R2 → MinIO mirror copies don't have to
// be re-keyed.
//
// Subscription gate: non-admin users must hold an active subscription
// to upload an override. The same `SubscriptionService.HasActive`
// check lives in `daily-playlists` and `ai/playlists`.

const (
	// 50 MiB upload ceiling — matches the worker
	// (`MAX_FILE_SIZE = 50 * 1024 * 1024` in StorageService.ts).
	maxOverrideUploadBytes int64 = 50 * 1024 * 1024
)

var (
	// Strict allowlist for override sources and track IDs. These end
	// up concatenated into the object key, so anything
	// user-controlled here could fan out into key-namespace
	// pollution or, on a different storage backend, path traversal.
	allowedOverrideSources = map[string]bool{
		"tidal":  true,
		"upload": true,
	}
	// Tidal track IDs are decimal integers; upload IDs are UUID4
	// hex+dash. 64 chars is plenty for either while still rejecting
	// `..`, `/`, spaces, and other weird bytes.
	overrideTrackIDRE = regexp.MustCompile(`^[a-zA-Z0-9_-]{1,64}$`)
	// MIME-type allowlist (matches worker's ALLOWED_TYPES). Audio
	// only — we don't want users smuggling arbitrary blobs through
	// the upload endpoint.
	allowedOverrideMimes = map[string]bool{
		"audio/mpeg": true,
		"audio/mp4":  true,
		"audio/flac": true,
		"audio/aac":  true,
		"audio/ogg":  true,
		"audio/wav":  true,
	}
)

// overrideSource pulls and validates `?source=` from the query string.
// Returns "" on invalid input — the caller emits the 400.
func overrideSource(r *http.Request) string {
	src := r.URL.Query().Get("source")
	if src == "" {
		src = "tidal"
	}
	if !allowedOverrideSources[src] {
		return ""
	}
	return src
}

// overrideKey returns the MinIO object key for the given triple.
// Mirrors `overrides/${userId}/${source}/${trackId}` from
// StorageService.ts. We don't run it through storage.IsSafeKey
// because that helper enforces a 64-char total cap which is too
// restrictive for a 3-segment composed key — the regex on the
// inputs (userID via JWT, source via allowlist, trackID via
// overrideTrackIDRE) already constrains every component.
func overrideKey(userID, source, trackID string) string {
	return "overrides/" + userID + "/" + source + "/" + trackID
}

// uploadOverride handles PUT /tracks/:id/override.
// Stores the raw body to MinIO and upserts the track_overrides row.
func uploadOverride(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID := httpx.UserID(r)
		if userID == "" {
			httpx.Err(w, http.StatusUnauthorized, "Требуется авторизация")
			return
		}
		trackID := chi.URLParam(r, "id")
		if !overrideTrackIDRE.MatchString(trackID) {
			httpx.Err(w, http.StatusBadRequest, "Неверный идентификатор трека")
			return
		}
		source := overrideSource(r)
		if source == "" {
			httpx.Err(w, http.StatusBadRequest, "Неверный source (допустимо: tidal, upload)")
			return
		}

		// Admins bypass the subscription gate — same as the worker.
		if !httpx.IsAdmin(r) {
			subs := a.Subs.(*services.SubscriptionService)
			ok, err := subs.HasActive(r.Context(), userID)
			if err != nil {
				httpx.Internal(w, err)
				return
			}
			if !ok {
				httpx.Err(w, http.StatusForbidden, "Перезалив доступен только для подписчиков")
				return
			}
		}

		contentType := r.Header.Get("Content-Type")
		if contentType == "" {
			contentType = "audio/mpeg"
		}
		if !allowedOverrideMimes[contentType] {
			httpx.Err(w, http.StatusBadRequest, "Неподдерживаемый формат: "+contentType)
			return
		}

		contentLength, _ := strconv.ParseInt(r.Header.Get("Content-Length"), 10, 64)
		if contentLength > maxOverrideUploadBytes {
			httpx.Err(w, http.StatusRequestEntityTooLarge,
				"Файл слишком большой. Максимум: 50 МБ")
			return
		}
		if r.Body == nil {
			httpx.Err(w, http.StatusBadRequest, "Тело запроса обязательно")
			return
		}

		// Cap the body even when the client lied about Content-Length.
		// MaxBytesReader returns an error during MinIO's Put if the
		// stream exceeds the limit, which we surface as 413.
		body := http.MaxBytesReader(w, r.Body, maxOverrideUploadBytes)
		defer body.Close()

		key := overrideKey(userID, source, trackID)
		// When the client didn't send a Content-Length, pass -1 so
		// the MinIO SDK switches into multipart-upload mode and
		// streams the unknown-length body up.
		size := contentLength
		if size <= 0 {
			size = -1
		}
		if err := a.Store.Put(r.Context(), key, body, size, contentType); err != nil {
			// MaxBytesReader surfaces oversize as a generic error; we
			// don't try to distinguish here — 400 with the worker's
			// message is enough for the client to surface a toast.
			httpx.Err(w, http.StatusBadRequest, "Ошибка загрузки: "+err.Error())
			return
		}

		// Track the real bytes-on-disk via Stat — the client's
		// Content-Length is advisory.
		actualSize, _ := a.Store.StatSize(r.Context(), key)
		if actualSize <= 0 {
			actualSize = contentLength
		}

		now := nowSec()
		_, err := a.DB.Exec(r.Context(),
			`INSERT INTO track_overrides (user_id, track_id, source, r2_key, mime_type, size_bytes, created_at)
			 VALUES ($1, $2, $3, $4, $5, $6, $7)
			 ON CONFLICT (user_id, track_id, source)
			 DO UPDATE SET r2_key = EXCLUDED.r2_key,
			               mime_type = EXCLUDED.mime_type,
			               size_bytes = EXCLUDED.size_bytes,
			               created_at = EXCLUDED.created_at`,
			userID, trackID, source, key, contentType, actualSize, now,
		)
		if err != nil {
			// Best-effort cleanup so an orphaned object doesn't
			// linger in MinIO when the row write failed.
			_ = a.Store.Delete(r.Context(), key)
			httpx.Internal(w, err)
			return
		}

		httpx.JSON(w, http.StatusOK, map[string]any{
			"ok":    true,
			"r2Key": key,
		})
	}
}

// deleteOverride handles DELETE /tracks/:id/override.
func deleteOverride(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID := httpx.UserID(r)
		if userID == "" {
			httpx.Err(w, http.StatusUnauthorized, "Требуется авторизация")
			return
		}
		trackID := chi.URLParam(r, "id")
		if !overrideTrackIDRE.MatchString(trackID) {
			httpx.Err(w, http.StatusBadRequest, "Неверный идентификатор трека")
			return
		}
		source := overrideSource(r)
		if source == "" {
			httpx.Err(w, http.StatusBadRequest, "Неверный source (допустимо: tidal, upload)")
			return
		}

		// Fetch the key first so we can delete the underlying R2/MinIO
		// object too — `track_overrides` is the only place the key
		// is stored.
		var key string
		err := a.DB.QueryRow(r.Context(),
			`SELECT r2_key FROM track_overrides
			   WHERE user_id = $1 AND track_id = $2 AND source = $3`,
			userID, trackID, source,
		).Scan(&key)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) || errors.Is(err, sql.ErrNoRows) {
				httpx.Err(w, http.StatusNotFound, "Перезалив не найден")
				return
			}
			httpx.Internal(w, err)
			return
		}

		// Delete the object first. If we did it in the other order
		// and the MinIO call failed, the client would see a 404 on
		// the next GET while the file lingered server-side.
		if err := a.Store.Delete(r.Context(), key); err != nil {
			// Object missing is fine (MinIO returns no error) — but
			// any other failure leaves the row in place so a retry
			// can resolve it.
			httpx.Internal(w, err)
			return
		}
		if _, err := a.DB.Exec(r.Context(),
			`DELETE FROM track_overrides
			   WHERE user_id = $1 AND track_id = $2 AND source = $3`,
			userID, trackID, source,
		); err != nil {
			httpx.Internal(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, map[string]any{"ok": true})
	}
}

// getOverride handles GET /tracks/:id/override.
// Returns { exists: false } when the row is missing, or the full
// row when it exists, matching the worker's response shape.
func getOverride(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID := httpx.UserID(r)
		if userID == "" {
			httpx.Err(w, http.StatusUnauthorized, "Требуется авторизация")
			return
		}
		trackID := chi.URLParam(r, "id")
		if !overrideTrackIDRE.MatchString(trackID) {
			httpx.Err(w, http.StatusBadRequest, "Неверный идентификатор трека")
			return
		}
		source := overrideSource(r)
		if source == "" {
			httpx.Err(w, http.StatusBadRequest, "Неверный source (допустимо: tidal, upload)")
			return
		}
		var (
			rKey       string
			mime       string
			size       int64
			createdAt  int64
		)
		err := a.DB.QueryRow(r.Context(),
			`SELECT r2_key, mime_type, size_bytes, created_at
			   FROM track_overrides
			   WHERE user_id = $1 AND track_id = $2 AND source = $3`,
			userID, trackID, source,
		).Scan(&rKey, &mime, &size, &createdAt)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) || errors.Is(err, sql.ErrNoRows) {
				httpx.JSON(w, http.StatusOK, map[string]any{"exists": false})
				return
			}
			httpx.Internal(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, map[string]any{
			"exists": true,
			"override": map[string]any{
				"user_id":    userID,
				"track_id":   trackID,
				"source":     source,
				"r2_key":     rKey,
				"mime_type":  mime,
				"size_bytes": size,
				"created_at": createdAt,
			},
		})
	}
}

// streamOverride handles GET /tracks/:id/override/stream — Range-aware
// proxy of the underlying MinIO object. Delegates to the shared
// `r2Stream` helper that already supports byte-range + ETag mirroring
// (see rooms.go).
func streamOverride(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID := httpx.UserID(r)
		if userID == "" {
			httpx.Err(w, http.StatusUnauthorized, "Требуется авторизация")
			return
		}
		trackID := chi.URLParam(r, "id")
		if !overrideTrackIDRE.MatchString(trackID) {
			httpx.Err(w, http.StatusBadRequest, "Неверный идентификатор трека")
			return
		}
		source := overrideSource(r)
		if source == "" {
			httpx.Err(w, http.StatusBadRequest, "Неверный source (допустимо: tidal, upload)")
			return
		}
		var (
			key  string
			mime string
		)
		err := a.DB.QueryRow(r.Context(),
			`SELECT r2_key, mime_type FROM track_overrides
			   WHERE user_id = $1 AND track_id = $2 AND source = $3`,
			userID, trackID, source,
		).Scan(&key, &mime)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) || errors.Is(err, sql.ErrNoRows) {
				httpx.Err(w, http.StatusNotFound, "Перезалив не найден")
				return
			}
			httpx.Internal(w, err)
			return
		}
		r2Stream(a, w, r, key, mime)
	}
}
