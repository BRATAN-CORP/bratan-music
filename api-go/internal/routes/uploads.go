package routes

import (
	"database/sql"
	"errors"
	"net/http"
	"regexp"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/bratan-corp/bratan-music/api-go/internal/app"
	"github.com/bratan-corp/bratan-music/api-go/internal/httpx"
)

// Ported from worker/src/routes/uploads.ts.
//
// User-owned audio uploads (the "MP3 uploader" feature in the
// sidebar). Lifecycle:
//
//   GET    /uploads               list user's tracks
//   GET    /uploads/:id           single track row
//   POST   /uploads               multipart upload, returns 201 row
//   PUT    /uploads/:id           edit metadata (title/artist/album/cover)
//   PUT    /uploads/:id/file      replace audio file but keep metadata
//   DELETE /uploads/:id           remove row + MinIO object + playlist refs
//   GET    /uploads/:id/stream    Range-aware audio stream
//
// Storage key shape: `uploads/<userId>/<uploadId>`. The trailing
// segment is a UUIDv4 so the key is path-safe by construction.

const (
	uploadMaxFileBytes   int64 = 50 * 1024 * 1024 // 50 MiB
	uploadMaxCoverBytes  int   = 256 * 1024       // raw byte cap
	uploadMaxCoverDataB64       = uploadMaxCoverBytes*7/5 + 64
	// Multipart parts can be larger than the audio itself for a few
	// stray bytes (boundary headers, form fields), so we allow a
	// 1 MiB cushion on top of the audio cap before chi's parser
	// hard-errors.
	uploadMultipartMaxBytes int64 = uploadMaxFileBytes + 1<<20
)

var (
	allowedUploadMIMEs = map[string]bool{
		"audio/mpeg":  true,
		"audio/mp4":   true,
		"audio/aac":   true,
		"audio/flac":  true,
		"audio/ogg":   true,
		"audio/wav":   true,
		"audio/x-wav": true,
		"audio/x-m4a": true,
	}
	uploadCoverDataURLRE = regexp.MustCompile(`^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$`)
)

// userTrackRow mirrors worker UserTrackRow.
type userTrackRow struct {
	ID        string
	UserID    string
	Title     string
	Artist    string
	Album     string
	CoverURL  sql.NullString
	Duration  int64
	R2Key     string
	MimeType  string
	SizeBytes int64
	CreatedAt int64
	UpdatedAt int64
}

func rowToTrackJSON(r userTrackRow) map[string]any {
	cover := ""
	if r.CoverURL.Valid {
		cover = r.CoverURL.String
	}
	return map[string]any{
		"id":        "upload:" + r.ID,
		"rawId":     r.ID,
		"title":     r.Title,
		"artist":    r.Artist,
		"album":     r.Album,
		"coverUrl":  cover,
		"duration":  r.Duration,
		"source":    "upload",
		"mimeType":  r.MimeType,
		"sizeBytes": r.SizeBytes,
		"createdAt": r.CreatedAt,
	}
}

const userTrackCols = `id, user_id, title, artist, album, cover_url, duration,
	r2_key, mime_type, size_bytes, created_at, updated_at`

func scanUserTrack(rs interface {
	Scan(dest ...any) error
}) (userTrackRow, error) {
	var r userTrackRow
	err := rs.Scan(&r.ID, &r.UserID, &r.Title, &r.Artist, &r.Album,
		&r.CoverURL, &r.Duration, &r.R2Key, &r.MimeType, &r.SizeBytes,
		&r.CreatedAt, &r.UpdatedAt)
	return r, err
}

// listUploads handles GET /uploads.
func listUploads(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID := httpx.UserID(r)
		rows, err := a.DB.Query(r.Context(),
			`SELECT `+userTrackCols+` FROM user_tracks
			   WHERE user_id = $1 ORDER BY created_at DESC`, userID)
		if err != nil {
			httpx.Internal(w, err)
			return
		}
		defer rows.Close()
		items := make([]map[string]any, 0, 32)
		for rows.Next() {
			ut, err := scanUserTrack(rows)
			if err != nil {
				httpx.Internal(w, err)
				return
			}
			items = append(items, rowToTrackJSON(ut))
		}
		if err := rows.Err(); err != nil {
			httpx.Internal(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, map[string]any{"items": items})
	}
}

// getUpload handles GET /uploads/:id.
func getUpload(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID := httpx.UserID(r)
		id := chi.URLParam(r, "id")
		row := a.DB.QueryRow(r.Context(),
			`SELECT `+userTrackCols+` FROM user_tracks
			   WHERE id = $1 AND user_id = $2`, id, userID)
		ut, err := scanUserTrack(row)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) || errors.Is(err, sql.ErrNoRows) {
				httpx.Err(w, http.StatusNotFound, "Не найдено")
				return
			}
			httpx.Internal(w, err)
			return
		}
		httpx.JSON(w, http.StatusOK, rowToTrackJSON(ut))
	}
}

// createUpload handles POST /uploads with multipart/form-data.
// Field "file" is the audio body, optional title/artist/album/duration/cover.
func createUpload(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID := httpx.UserID(r)
		if !strings.HasPrefix(r.Header.Get("Content-Type"), "multipart/form-data") {
			httpx.Err(w, http.StatusBadRequest, "Ожидается multipart/form-data")
			return
		}
		// Cap the multipart body at the audio limit + cushion.
		r.Body = http.MaxBytesReader(w, r.Body, uploadMultipartMaxBytes)
		if err := r.ParseMultipartForm(8 << 20); err != nil {
			httpx.Err(w, http.StatusRequestEntityTooLarge,
				"Файл слишком большой. Лимит 50 МБ")
			return
		}
		file, fileHdr, err := r.FormFile("file")
		if err != nil {
			httpx.Err(w, http.StatusBadRequest, "Файл не передан")
			return
		}
		defer file.Close()
		if fileHdr.Size > uploadMaxFileBytes {
			httpx.Err(w, http.StatusRequestEntityTooLarge,
				"Файл слишком большой. Лимит 50 МБ")
			return
		}
		mime := strings.ToLower(fileHdr.Header.Get("Content-Type"))
		if mime == "" {
			mime = "audio/mpeg"
		}
		if !allowedUploadMIMEs[mime] {
			httpx.Err(w, http.StatusUnsupportedMediaType, "Неподдерживаемый формат: "+mime)
			return
		}

		title := trimAt(r.FormValue("title"), 200)
		if title == "" {
			// Use the filename without extension as the fallback,
			// matching the worker shape.
			base := fileHdr.Filename
			if dot := strings.LastIndex(base, "."); dot > 0 {
				base = base[:dot]
			}
			title = trimAt(base, 200)
			if title == "" {
				title = "Без названия"
			}
		}
		artist := trimAt(r.FormValue("artist"), 200)
		album := trimAt(r.FormValue("album"), 200)
		duration, _ := strconv.ParseInt(strings.TrimSpace(r.FormValue("duration")), 10, 64)
		if duration < 0 {
			duration = 0
		}

		var coverURL sql.NullString
		if rawCover := r.FormValue("cover"); rawCover != "" {
			if !uploadCoverDataURLRE.MatchString(rawCover) || len(rawCover) > uploadMaxCoverDataB64 {
				httpx.Err(w, http.StatusBadRequest, "Некорректная обложка")
				return
			}
			coverURL = sql.NullString{Valid: true, String: rawCover}
		}

		id := uuid.NewString()
		key := "uploads/" + userID + "/" + id
		// Stream upload to MinIO. ParseMultipartForm has already
		// either spooled the part to disk or kept it in memory, so
		// `file` is a seekable io.Reader either way.
		if err := a.Store.Put(r.Context(), key, file, fileHdr.Size, mime); err != nil {
			httpx.Internal(w, err)
			return
		}

		now := nowSec()
		_, err = a.DB.Exec(r.Context(),
			`INSERT INTO user_tracks
			   (id, user_id, title, artist, album, cover_url, duration,
			    r2_key, mime_type, size_bytes, created_at, updated_at)
			 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
			id, userID, title, artist, album, coverURL, duration,
			key, mime, fileHdr.Size, now, now,
		)
		if err != nil {
			_ = a.Store.Delete(r.Context(), key)
			httpx.Internal(w, err)
			return
		}
		out := rowToTrackJSON(userTrackRow{
			ID: id, UserID: userID, Title: title, Artist: artist,
			Album: album, CoverURL: coverURL, Duration: duration,
			R2Key: key, MimeType: mime, SizeBytes: fileHdr.Size,
			CreatedAt: now, UpdatedAt: now,
		})
		httpx.JSON(w, http.StatusCreated, out)
	}
}

// updateUploadMeta handles PUT /uploads/:id.
// Body shape: { title?, artist?, album?, cover?: string|null }.
func updateUploadMeta(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID := httpx.UserID(r)
		id := chi.URLParam(r, "id")
		// Use raw decoder so we can tell "cover: null" (clear) apart
		// from "cover absent" (keep existing).
		body := struct {
			Title  *string `json:"title"`
			Artist *string `json:"artist"`
			Album  *string `json:"album"`
			Cover  *string `json:"cover"`
			// HasCover lets us track whether the key was present at
			// all; we set it in a custom UnmarshalJSON below.
		}{}
		// json.Decoder handles `null` as nil pointer, which is the
		// exact "clear" signal we need. The "absent" case stays
		// distinguishable by checking ok on a tracking map.
		var rawProbe map[string]any
		if err := httpx.BindJSON(r, &rawProbe, 8<<10); err != nil {
			httpx.Err(w, http.StatusBadRequest, "Некорректный JSON")
			return
		}
		// Re-decode into the typed shape from the same map (zero
		// extra network).
		if v, ok := rawProbe["title"].(string); ok {
			body.Title = &v
		}
		if v, ok := rawProbe["artist"].(string); ok {
			body.Artist = &v
		}
		if v, ok := rawProbe["album"].(string); ok {
			body.Album = &v
		}
		coverPresent := false
		if v, ok := rawProbe["cover"]; ok {
			coverPresent = true
			if s, isStr := v.(string); isStr {
				body.Cover = &s
			}
		}

		existRow := a.DB.QueryRow(r.Context(),
			`SELECT `+userTrackCols+` FROM user_tracks
			   WHERE id = $1 AND user_id = $2`, id, userID)
		existing, err := scanUserTrack(existRow)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) || errors.Is(err, sql.ErrNoRows) {
				httpx.Err(w, http.StatusNotFound, "Не найдено")
				return
			}
			httpx.Internal(w, err)
			return
		}

		title := existing.Title
		if body.Title != nil {
			t := trimAt(*body.Title, 200)
			if t == "" {
				t = "Без названия"
			}
			title = t
		}
		artist := existing.Artist
		if body.Artist != nil {
			artist = trimAt(*body.Artist, 200)
		}
		album := existing.Album
		if body.Album != nil {
			album = trimAt(*body.Album, 200)
		}
		coverURL := existing.CoverURL
		if coverPresent {
			if body.Cover == nil || *body.Cover == "" {
				// Explicit clear.
				coverURL = sql.NullString{Valid: false}
			} else {
				raw := *body.Cover
				if !uploadCoverDataURLRE.MatchString(raw) || len(raw) > uploadMaxCoverDataB64 {
					httpx.Err(w, http.StatusBadRequest, "Некорректная обложка")
					return
				}
				coverURL = sql.NullString{Valid: true, String: raw}
			}
		}

		now := nowSec()
		_, err = a.DB.Exec(r.Context(),
			`UPDATE user_tracks
			    SET title=$1, artist=$2, album=$3, cover_url=$4, updated_at=$5
			    WHERE id=$6`,
			title, artist, album, coverURL, now, id,
		)
		if err != nil {
			httpx.Internal(w, err)
			return
		}
		existing.Title = title
		existing.Artist = artist
		existing.Album = album
		existing.CoverURL = coverURL
		existing.UpdatedAt = now
		httpx.JSON(w, http.StatusOK, rowToTrackJSON(existing))
	}
}

// replaceUploadFile handles PUT /uploads/:id/file — keep metadata,
// swap the audio.
func replaceUploadFile(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID := httpx.UserID(r)
		id := chi.URLParam(r, "id")
		if !strings.HasPrefix(r.Header.Get("Content-Type"), "multipart/form-data") {
			httpx.Err(w, http.StatusBadRequest, "Ожидается multipart/form-data")
			return
		}
		existRow := a.DB.QueryRow(r.Context(),
			`SELECT `+userTrackCols+` FROM user_tracks
			   WHERE id = $1 AND user_id = $2`, id, userID)
		existing, err := scanUserTrack(existRow)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) || errors.Is(err, sql.ErrNoRows) {
				httpx.Err(w, http.StatusNotFound, "Не найдено")
				return
			}
			httpx.Internal(w, err)
			return
		}

		r.Body = http.MaxBytesReader(w, r.Body, uploadMultipartMaxBytes)
		if err := r.ParseMultipartForm(8 << 20); err != nil {
			httpx.Err(w, http.StatusRequestEntityTooLarge,
				"Файл слишком большой. Лимит 50 МБ")
			return
		}
		file, fileHdr, err := r.FormFile("file")
		if err != nil {
			httpx.Err(w, http.StatusBadRequest, "Файл не передан")
			return
		}
		defer file.Close()
		if fileHdr.Size > uploadMaxFileBytes {
			httpx.Err(w, http.StatusRequestEntityTooLarge,
				"Файл слишком большой. Лимит 50 МБ")
			return
		}
		mime := strings.ToLower(fileHdr.Header.Get("Content-Type"))
		if mime == "" {
			mime = existing.MimeType
		}
		if !allowedUploadMIMEs[mime] {
			httpx.Err(w, http.StatusUnsupportedMediaType, "Неподдерживаемый формат: "+mime)
			return
		}
		duration := existing.Duration
		if v, err := strconv.ParseInt(strings.TrimSpace(r.FormValue("duration")), 10, 64); err == nil && v > 0 {
			duration = v
		}

		// Same r2_key as before — overwrite in place.
		if err := a.Store.Put(r.Context(), existing.R2Key, file, fileHdr.Size, mime); err != nil {
			httpx.Internal(w, err)
			return
		}
		now := nowSec()
		if _, err := a.DB.Exec(r.Context(),
			`UPDATE user_tracks
			    SET mime_type=$1, size_bytes=$2, duration=$3, updated_at=$4
			    WHERE id=$5`,
			mime, fileHdr.Size, duration, now, id,
		); err != nil {
			httpx.Internal(w, err)
			return
		}
		existing.MimeType = mime
		existing.SizeBytes = fileHdr.Size
		existing.Duration = duration
		existing.UpdatedAt = now
		httpx.JSON(w, http.StatusOK, rowToTrackJSON(existing))
	}
}

// deleteUpload handles DELETE /uploads/:id.
func deleteUpload(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID := httpx.UserID(r)
		id := chi.URLParam(r, "id")
		var key string
		err := a.DB.QueryRow(r.Context(),
			`SELECT r2_key FROM user_tracks WHERE id = $1 AND user_id = $2`,
			id, userID,
		).Scan(&key)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) || errors.Is(err, sql.ErrNoRows) {
				httpx.Err(w, http.StatusNotFound, "Не найдено")
				return
			}
			httpx.Internal(w, err)
			return
		}
		// MinIO delete is idempotent — missing object isn't an error.
		_ = a.Store.Delete(r.Context(), key)
		if _, err := a.DB.Exec(r.Context(),
			`DELETE FROM user_tracks WHERE id = $1`, id,
		); err != nil {
			httpx.Internal(w, err)
			return
		}
		// Strip from playlists so the user doesn't end up with
		// phantom tracks (worker parity).
		_, _ = a.DB.Exec(r.Context(),
			`DELETE FROM playlist_tracks WHERE track_id = $1 AND source = 'upload'`, id)
		httpx.JSON(w, http.StatusOK, map[string]any{"ok": true})
	}
}

// streamUpload handles GET /uploads/:id/stream with Range support.
// Auth middleware (JWT) accepts ?token= fallback for `<audio>`-like
// callers that can't attach an Authorization header.
func streamUpload(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID := httpx.UserID(r)
		id := chi.URLParam(r, "id")
		var (
			key  string
			mime string
		)
		err := a.DB.QueryRow(r.Context(),
			`SELECT r2_key, mime_type FROM user_tracks
			   WHERE id = $1 AND user_id = $2`, id, userID,
		).Scan(&key, &mime)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) || errors.Is(err, sql.ErrNoRows) {
				httpx.Err(w, http.StatusNotFound, "Не найдено")
				return
			}
			httpx.Internal(w, err)
			return
		}
		r2Stream(a, w, r, key, mime)
	}
}

// trimAt trims surrounding whitespace and truncates to max runes.
func trimAt(s string, max int) string {
	s = strings.TrimSpace(s)
	if len([]rune(s)) <= max {
		return s
	}
	runes := []rune(s)
	return string(runes[:max])
}
