// Command api is the Bratan Music backend, ported from worker/src/*.ts.
//
// Lifecycle:
//  1. Load config from env (`internal/config`)
//  2. Open Postgres, Redis, MinIO clients
//  3. Apply embedded + on-disk SQL migrations
//  4. Wire services into an `*app.App` container
//  5. Mount chi routes and the WebSocket hub
//  6. Block on the HTTP server until SIGINT/SIGTERM, then graceful shutdown
package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/bratan-corp/bratan-music/api-go/internal/app"
	"github.com/bratan-corp/bratan-music/api-go/internal/config"
	"github.com/bratan-corp/bratan-music/api-go/internal/db"
	"github.com/bratan-corp/bratan-music/api-go/internal/migrations"
	"github.com/bratan-corp/bratan-music/api-go/internal/redisx"
	"github.com/bratan-corp/bratan-music/api-go/internal/router"
	"github.com/bratan-corp/bratan-music/api-go/internal/storage"
)

func main() {
	if err := run(); err != nil {
		slog.Error("fatal startup error", "err", err)
		os.Exit(1)
	}
}

func run() error {
	logger := newLogger()
	slog.SetDefault(logger)

	cfg, err := config.Load()
	if err != nil {
		return fmt.Errorf("config: %w", err)
	}
	logger.Info("config loaded",
		"port", cfg.Port,
		"env", cfg.Environment,
		"domain", cfg.Domain,
	)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	database, err := db.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		return fmt.Errorf("db: %w", err)
	}
	logger.Info("postgres connected")

	rdb, err := redisx.Open(ctx, cfg.RedisURL)
	if err != nil {
		return fmt.Errorf("redis: %w", err)
	}
	logger.Info("redis connected")

	store, err := storage.Open(ctx,
		cfg.MinIOEndpoint, cfg.MinIOPort, cfg.MinIOUseSSL,
		cfg.MinIOAccess, cfg.MinIOSecret, cfg.MinIOBucket,
	)
	if err != nil {
		return fmt.Errorf("minio: %w", err)
	}
	logger.Info("minio ready", "bucket", store.Bucket())

	// Apply schema + legacy migrations. The disk path lets us pick up
	// new files committed under worker/src/db/migrations/ without
	// rebuilding the binary.
	if err := migrations.Apply(ctx, database.Pool, "worker/src/db/migrations"); err != nil {
		return fmt.Errorf("migrations: %w", err)
	}
	logger.Info("migrations applied")

	a := &app.App{
		Cfg:    cfg,
		DB:     database,
		Redis:  rdb,
		Store:  store,
		Logger: logger,
	}
	router.Wire(a)

	mux := router.Build(a)
	server := &http.Server{
		Addr:              fmt.Sprintf(":%d", cfg.Port),
		Handler:           mux,
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       120 * time.Second,
	}

	go func() {
		logger.Info("http listen", "addr", server.Addr)
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			logger.Error("http server", "err", err)
			cancel()
		}
	}()

	// Cron — same schedule as the legacy wrangler.toml: 04:30 UTC daily.
	go router.RunCronLoop(ctx, a)

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	select {
	case <-stop:
		logger.Info("shutdown requested")
	case <-ctx.Done():
		logger.Info("context cancelled, shutting down")
	}

	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer shutdownCancel()
	_ = server.Shutdown(shutdownCtx)
	a.Shutdown(shutdownCtx)
	return nil
}

func newLogger() *slog.Logger {
	level := slog.LevelInfo
	if os.Getenv("NODE_ENV") != "production" {
		level = slog.LevelDebug
	}
	h := slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: level})
	return slog.New(h)
}
