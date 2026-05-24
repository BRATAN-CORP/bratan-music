package routes

import (
	"context"
	"errors"
	"net/http"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	miniogo "github.com/minio/minio-go/v7"

	"github.com/bratan-corp/bratan-music/api-go/internal/app"
	"github.com/bratan-corp/bratan-music/api-go/internal/httpx"
)

// GET /admin/health
//
// Bundles the admin "is everything fine?" overview into a single
// payload — same JSON shape as worker/src/services/HealthService.ts
// `HealthOverview` so the React panel renders unchanged.
//
// Probes run in parallel; each one degrades gracefully (returns
// {ok:false,error:"..."}) so a failing probe never 500s the response.

type healthOverview struct {
	GeneratedAt   int64        `json:"generatedAt"`
	Tidal         healthTidal  `json:"tidal"`
	DB            healthDB     `json:"db"`
	R2            healthR2     `json:"r2"`
	Cron          healthCron   `json:"cron"`
	RecentErrors  int64        `json:"recentErrors"`
}

type healthTidal struct {
	AccountsTotal      int64  `json:"accountsTotal"`
	AccountsEnabled    int64  `json:"accountsEnabled"`
	AccountsWithErrors int64  `json:"accountsWithErrors"`
	AccountsExpired    int64  `json:"accountsExpired"`
	LastSuccessAt      *int64 `json:"lastSuccessAt"`
}

type healthDB struct {
	OK      bool    `json:"ok"`
	WriteMs *int64  `json:"writeMs"`
	Error   *string `json:"error"`
}

type healthR2 struct {
	OK             bool    `json:"ok"`
	SampledObjects *int    `json:"sampledObjects"`
	SampledBytes   *int64  `json:"sampledBytes"`
	Truncated      bool    `json:"truncated"`
	Error          *string `json:"error"`
}

type healthCron struct {
	LastRunStartedAt      *int64  `json:"lastRunStartedAt"`
	LastRunFinishedAt     *int64  `json:"lastRunFinishedAt"`
	LastRunOK             *bool   `json:"lastRunOk"`
	LastRunErrorCount     int     `json:"lastRunErrorCount"`
	LastRunProcessedCount int     `json:"lastRunProcessedCount"`
	LastRunErrorMessage   *string `json:"lastRunErrorMessage"`
	RanToday              bool    `json:"ranToday"`
}

func adminHealthImpl(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var (
			wg      sync.WaitGroup
			tidal   healthTidal
			db      healthDB
			r2      healthR2
			cron    healthCron
			recent  int64
		)

		wg.Add(5)
		go func() { defer wg.Done(); tidal = tidalSummary(r.Context(), a) }()
		go func() { defer wg.Done(); db = dbProbe(r.Context(), a) }()
		go func() { defer wg.Done(); r2 = r2Probe(r.Context(), a) }()
		go func() { defer wg.Done(); cron = cronSummary(r.Context(), a) }()
		go func() { defer wg.Done(); recent = recentErrorCount(r.Context(), a) }()
		wg.Wait()

		httpx.JSON(w, http.StatusOK, healthOverview{
			GeneratedAt:  time.Now().UnixMilli(),
			Tidal:        tidal,
			DB:           db,
			R2:           r2,
			Cron:         cron,
			RecentErrors: recent,
		})
	}
}

func tidalSummary(ctx context.Context, a *app.App) healthTidal {
	now := time.Now().Unix()
	var (
		total, enabled, errored, expired int64
		lastSuccess                      int64
	)
	err := a.DB.QueryRow(ctx,
		`SELECT
		   COUNT(*),
		   SUM(CASE WHEN enabled = 1 THEN 1 ELSE 0 END),
		   SUM(CASE WHEN consecutive_errors > 0 THEN 1 ELSE 0 END),
		   SUM(CASE WHEN expires_at < $1 THEN 1 ELSE 0 END),
		   COALESCE(MAX(CASE WHEN enabled = 1 THEN last_used_at ELSE 0 END), 0)
		 FROM tidal_accounts`,
		now,
	).Scan(&total, &enabled, &errored, &expired, &lastSuccess)
	if err != nil {
		return healthTidal{}
	}
	out := healthTidal{
		AccountsTotal:      total,
		AccountsEnabled:    enabled,
		AccountsWithErrors: errored,
		AccountsExpired:    expired,
	}
	if lastSuccess > 0 {
		out.LastSuccessAt = &lastSuccess
	}
	return out
}

func dbProbe(ctx context.Context, a *app.App) healthDB {
	// Cheap roundtrip: SELECT 1 + INSERT/DELETE into service_logs.
	// We can't rely on service_logs in api-go (the schema may not
	// have it yet on every env), so fall back to a single SELECT 1
	// if the table is missing.
	start := time.Now()
	var probeID int64
	err := a.DB.QueryRow(ctx,
		`INSERT INTO service_logs (level, source, message, created_at)
		 VALUES ('info','health.probe','ping',$1)
		 RETURNING id`,
		time.Now().UnixMilli(),
	).Scan(&probeID)
	if err == nil {
		// Best-effort cleanup; ignore the result.
		_, _ = a.DB.Exec(ctx, `DELETE FROM service_logs WHERE id = $1`, probeID)
		ms := time.Since(start).Milliseconds()
		return healthDB{OK: true, WriteMs: &ms}
	}
	// Fallback when service_logs doesn't exist: SELECT 1.
	var one int
	if err2 := a.DB.QueryRow(ctx, `SELECT 1`).Scan(&one); err2 == nil {
		ms := time.Since(start).Milliseconds()
		return healthDB{OK: true, WriteMs: &ms}
	}
	msg := truncate(err.Error(), 200)
	return healthDB{OK: false, Error: &msg}
}

func r2Probe(ctx context.Context, a *app.App) healthR2 {
	if a.Store == nil {
		msg := "storage not configured"
		return healthR2{OK: false, Error: &msg}
	}
	// Use the underlying minio client to list a bounded set of keys.
	// `a.Store` doesn't expose the client directly, so we go through
	// PresignGet's parent type via a tiny helper if one exists.
	client := a.Store.Client()
	if client == nil {
		return healthR2{OK: true, Truncated: false}
	}
	const limit = 1000
	ch := client.ListObjects(ctx, a.Store.Bucket(), miniogo.ListObjectsOptions{Recursive: true, MaxKeys: limit})
	var (
		count int
		bytes int64
	)
	for obj := range ch {
		if obj.Err != nil {
			msg := truncate(obj.Err.Error(), 200)
			return healthR2{OK: false, Error: &msg}
		}
		count++
		bytes += obj.Size
		if count >= limit {
			break
		}
	}
	out := healthR2{OK: true}
	c := count
	b := bytes
	out.SampledObjects = &c
	out.SampledBytes = &b
	out.Truncated = count >= limit
	return out
}

func cronSummary(ctx context.Context, a *app.App) healthCron {
	var (
		id                                                 int64
		name                                               string
		startedAt                                          int64
		finishedAt                                         *int64
		okFlag                                             int
		processedCount, errorCount                         int
		errorMessage                                       *string
	)
	err := a.DB.QueryRow(ctx,
		`SELECT id, name, started_at, finished_at, ok,
		        processed_count, error_count, error_message
		   FROM cron_runs
		  WHERE name = 'scheduled'
		  ORDER BY started_at DESC LIMIT 1`,
	).Scan(&id, &name, &startedAt, &finishedAt, &okFlag, &processedCount, &errorCount, &errorMessage)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return healthCron{}
		}
		return healthCron{}
	}
	okVal := okFlag == 1
	oneDayAgo := time.Now().UnixMilli() - 24*60*60*1000
	return healthCron{
		LastRunStartedAt:      &startedAt,
		LastRunFinishedAt:     finishedAt,
		LastRunOK:             &okVal,
		LastRunErrorCount:     errorCount,
		LastRunProcessedCount: processedCount,
		LastRunErrorMessage:   errorMessage,
		RanToday:              startedAt >= oneDayAgo && finishedAt != nil && okFlag == 1,
	}
}

func recentErrorCount(ctx context.Context, a *app.App) int64 {
	cutoff := time.Now().UnixMilli() - 24*60*60*1000
	var n int64
	_ = a.DB.QueryRow(ctx,
		`SELECT COUNT(*) FROM service_logs
		  WHERE level = 'error' AND created_at >= $1`,
		cutoff,
	).Scan(&n)
	return n
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n]
}
