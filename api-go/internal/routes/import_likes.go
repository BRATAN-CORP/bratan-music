package routes

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/bratan-corp/bratan-music/api-go/internal/app"
	"github.com/bratan-corp/bratan-music/api-go/internal/httpx"
	"github.com/bratan-corp/bratan-music/api-go/internal/middleware"
	"github.com/bratan-corp/bratan-music/api-go/internal/tidal"
	"github.com/go-chi/chi/v5"
)

// Likes import: the user exports their library from another service
// (Yandex Music via TuneMyMusic/MusConv, Spotify via Soundiiz, …) as a
// CSV, the frontend parses it client-side and POSTs the rows here. We
// match each row against the Tidal catalogue — by ISRC when the export
// carries one (exact, collision-free), otherwise by normalized
// artist+title with a duration sanity check — and like every confident
// match into the user's liked playlist.
//
// Jobs run in a background goroutine and are tracked in an in-memory
// registry: the deployment is a single api-go container (see
// deploy/docker-compose.yml), so cross-instance state is not a concern.
// Jobs are evicted ~1h after completion.

const (
	importMaxRows = 3000
	// Delay between Tidal search calls so a 2k-track import doesn't
	// hammer the shared account pool.
	importStepDelay = 120 * time.Millisecond
	importJobTTL    = time.Hour
)

type importRow struct {
	Title    string `json:"title"`
	Artist   string `json:"artist"`
	Album    string `json:"album,omitempty"`
	ISRC     string `json:"isrc,omitempty"`
	Duration int    `json:"duration,omitempty"` // seconds
}

type importFailure struct {
	Title  string `json:"title"`
	Artist string `json:"artist"`
	Reason string `json:"reason"` // "not_found" | "error"
}

type importJob struct {
	mu        sync.Mutex
	UserID    string
	Total     int
	Processed int
	Matched   int
	Failed    []importFailure
	Done      bool
	doneAt    time.Time
}

func (j *importJob) snapshot() map[string]any {
	j.mu.Lock()
	defer j.mu.Unlock()
	failed := make([]importFailure, len(j.Failed))
	copy(failed, j.Failed)
	return map[string]any{
		"total":     j.Total,
		"processed": j.Processed,
		"matched":   j.Matched,
		"failed":    failed,
		"done":      j.Done,
	}
}

var (
	importJobsMu sync.Mutex
	importJobs   = map[string]*importJob{}
)

func newImportJobID() string {
	b := make([]byte, 8)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// evictStaleImportJobs drops finished jobs older than importJobTTL.
// Called inline on job creation — cheap (map is tiny) and avoids a
// dedicated janitor goroutine.
func evictStaleImportJobs() {
	now := time.Now()
	for id, j := range importJobs {
		j.mu.Lock()
		stale := j.Done && now.Sub(j.doneAt) > importJobTTL
		j.mu.Unlock()
		if stale {
			delete(importJobs, id)
		}
	}
}

func mountImport(a *app.App) func(chi.Router) {
	return func(r chi.Router) {
		r.Use(middleware.JWTAuth(a.Cfg.JWTSecret, a.DB))
		r.Post("/likes", startLikesImport(a))
		r.Get("/likes/{jobId}", likesImportStatus(a))
	}
}

func startLikesImport(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		uid := httpx.UserID(r)
		var body struct {
			Tracks []importRow `json:"tracks"`
		}
		// 4 MB is plenty: 3000 rows × ~200 bytes.
		if err := httpx.BindJSON(r, &body, 4<<20); err != nil {
			httpx.Err(w, http.StatusBadRequest, "invalid body")
			return
		}
		rows := make([]importRow, 0, len(body.Tracks))
		for _, t := range body.Tracks {
			if strings.TrimSpace(t.Title) == "" {
				continue
			}
			rows = append(rows, t)
		}
		if len(rows) == 0 {
			httpx.Err(w, http.StatusBadRequest, "no tracks")
			return
		}
		if len(rows) > importMaxRows {
			httpx.Err(w, http.StatusBadRequest, "too many tracks")
			return
		}

		job := &importJob{UserID: uid, Total: len(rows)}
		id := newImportJobID()
		importJobsMu.Lock()
		evictStaleImportJobs()
		importJobs[id] = job
		importJobsMu.Unlock()

		go runLikesImport(a, job, rows)

		httpx.JSON(w, http.StatusAccepted, map[string]any{"jobId": id, "total": len(rows)})
	}
}

func likesImportStatus(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		uid := httpx.UserID(r)
		id := chi.URLParam(r, "jobId")
		importJobsMu.Lock()
		job := importJobs[id]
		importJobsMu.Unlock()
		// Jobs are user-scoped: never leak someone else's import report.
		if job == nil || job.UserID != uid {
			httpx.NotFound(w)
			return
		}
		httpx.JSON(w, http.StatusOK, job.snapshot())
	}
}

// runLikesImport executes the matching loop. Detached from the request
// context on purpose — the user navigates away and polls the status
// endpoint instead of holding the connection open.
func runLikesImport(a *app.App, job *importJob, rows []importRow) {
	ctx := context.Background()
	defer func() {
		job.mu.Lock()
		job.Done = true
		job.doneAt = time.Now()
		job.mu.Unlock()
	}()

	pid, err := ensureLikedPlaylist(ctx, a.DB, job.UserID)
	if err != nil {
		a.Logger.Error("import: ensureLikedPlaylist failed", "err", err)
		job.mu.Lock()
		for _, row := range rows {
			job.Failed = append(job.Failed, importFailure{Title: row.Title, Artist: row.Artist, Reason: "error"})
		}
		job.Processed = len(rows)
		job.mu.Unlock()
		return
	}

	search := func(ctx context.Context, q string, limit int) ([]tidal.TrackRaw, error) {
		resp, err := tidalSvc(a).API.Search(ctx, q, "TRACKS", limit, 0)
		if err != nil {
			return nil, err
		}
		return tidal.UnwrapBucket[tidal.TrackRaw](resp.Tracks), nil
	}
	for _, row := range rows {
		match, err := matchImportRow(ctx, search, row)
		job.mu.Lock()
		job.Processed++
		switch {
		case err != nil:
			job.Failed = append(job.Failed, importFailure{Title: row.Title, Artist: row.Artist, Reason: "error"})
		case match == nil:
			job.Failed = append(job.Failed, importFailure{Title: row.Title, Artist: row.Artist, Reason: "not_found"})
		default:
			if likeErr := likeImportedTrack(ctx, a, pid, *match); likeErr != nil {
				a.Logger.Error("import: like failed", "track", match.ID, "err", likeErr)
				job.Failed = append(job.Failed, importFailure{Title: row.Title, Artist: row.Artist, Reason: "error"})
			} else {
				job.Matched++
			}
		}
		job.mu.Unlock()
		time.Sleep(importStepDelay)
	}
}

// importSearchFn abstracts the Tidal track search so the matching
// logic is unit-testable without the live API.
type importSearchFn func(ctx context.Context, query string, limit int) ([]tidal.TrackRaw, error)

// matchImportRow finds the Tidal track for an exported row. nil, nil
// means "confidently not found".
func matchImportRow(ctx context.Context, search importSearchFn, row importRow) (*tidal.Track, error) {
	// 1) ISRC: the same recording carries the same code on every
	// service, so a verified hit needs no further heuristics.
	if isrc := strings.ToUpper(strings.TrimSpace(row.ISRC)); isrc != "" {
		raws, err := search(ctx, isrc, 5)
		if err == nil {
			for i := range raws {
				if strings.EqualFold(strings.TrimSpace(raws[i].ISRC), isrc) {
					t := tidal.MapTrack(&raws[i])
					return &t, nil
				}
			}
		}
		// ISRC miss is not fatal — fall through to metadata matching
		// (Tidal's search doesn't always index by ISRC).
	}

	// 2) Metadata: normalized artist+title, duration sanity check.
	query := strings.TrimSpace(row.Artist + " " + row.Title)
	raws, err := search(ctx, query, 10)
	if err != nil {
		return nil, err
	}
	best, bestScore := -1, 0
	for i := range raws {
		score := scoreImportCandidate(row, &raws[i])
		if score > bestScore {
			best, bestScore = i, score
		}
	}
	// Threshold 5 = at least a title match (3) + artist match (2).
	if best < 0 || bestScore < 5 {
		return nil, nil
	}
	t := tidal.MapTrack(&raws[best])
	return &t, nil
}

// normalizeForMatch — thin alias over the shared tidal.NormalizeForMatch
// (moved into the tidal package so the recording-level dedupe and the
// lyrics twin-fallback reuse the exact same normalisation).
func normalizeForMatch(s string) string {
	return tidal.NormalizeForMatch(s)
}

func scoreImportCandidate(row importRow, cand *tidal.TrackRaw) int {
	candTitle := normalizeForMatch(cand.Title)
	rowTitle := normalizeForMatch(row.Title)
	if candTitle == "" || rowTitle == "" {
		return 0
	}
	score := 0
	switch {
	case candTitle == rowTitle:
		score += 3
	case strings.Contains(candTitle, rowTitle) || strings.Contains(rowTitle, candTitle):
		score += 2
	default:
		return 0 // title mismatch → never a match, whatever the artist says
	}

	rowArtist := normalizeForMatch(row.Artist)
	artistOK := false
	for _, a := range cand.Artists {
		n := normalizeForMatch(a.Name)
		if n != "" && (strings.Contains(rowArtist, n) || strings.Contains(n, rowArtist)) {
			artistOK = true
			break
		}
	}
	if !artistOK && cand.Artist != nil {
		n := normalizeForMatch(cand.Artist.Name)
		artistOK = n != "" && (strings.Contains(rowArtist, n) || strings.Contains(n, rowArtist))
	}
	if artistOK {
		score += 2
	} else if rowArtist != "" {
		return 0 // wrong artist — a cover/karaoke version, not the track
	}

	if row.Duration > 0 && cand.Duration > 0 {
		diff := row.Duration - cand.Duration
		if diff < 0 {
			diff = -diff
		}
		switch {
		case diff <= 3:
			score++
		case diff > 15:
			score -= 3 // same name, very different length → remix/live
		}
	}
	return score
}

// likeImportedTrack inserts the matched track into the liked playlist
// with a full snapshot (same shape the frontend persists on manual
// like), skipping duplicates.
func likeImportedTrack(ctx context.Context, a *app.App, pid string, t tidal.Track) error {
	var exists string
	_ = a.DB.QueryRow(ctx,
		`SELECT track_id FROM playlist_tracks WHERE playlist_id = $1 AND track_id = $2`,
		pid, t.ID).Scan(&exists)
	if exists != "" {
		return nil // already liked — counts as matched, no duplicate row
	}
	snap, err := json.Marshal(t)
	if err != nil {
		return err
	}
	var maxPos int
	_ = a.DB.QueryRow(ctx,
		`SELECT COALESCE(MAX(position),-1) FROM playlist_tracks WHERE playlist_id = $1`, pid,
	).Scan(&maxPos)
	_, err = a.DB.Exec(ctx,
		`INSERT INTO playlist_tracks(playlist_id, track_id, source, position, added_at, snapshot)
		 VALUES ($1, $2, $3, $4, $5, $6)
		 ON CONFLICT (playlist_id, track_id) DO NOTHING`,
		pid, t.ID, t.Source, maxPos+1, nowSec(), string(snap))
	return err
}
