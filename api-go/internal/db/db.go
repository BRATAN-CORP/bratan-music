// Package db wraps the Postgres pool used by the API.
//
// The legacy worker code addressed D1 (SQLite) directly with parameterised
// queries; we keep parameterised SQL but speak Postgres via pgx/v5. Tables
// and column names are identical (see worker/init-db/001_schema.sql).
package db

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// DB is the global database handle. It's intentionally a thin alias over the
// pgx pool so route/service code can pull just the operations it needs
// without mocking an entire interface tower.
type DB struct {
	*pgxpool.Pool
}

// Open creates the pgx pool, pings it, and returns a wrapped handle. The
// caller is responsible for calling Close() on shutdown.
func Open(ctx context.Context, dsn string) (*DB, error) {
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		return nil, fmt.Errorf("pgx parse: %w", err)
	}
	cfg.MaxConns = 20
	cfg.MinConns = 2
	cfg.MaxConnLifetime = 30 * time.Minute
	cfg.MaxConnIdleTime = 5 * time.Minute

	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("pgx pool: %w", err)
	}

	pingCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if err := pool.Ping(pingCtx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("pgx ping: %w", err)
	}

	return &DB{Pool: pool}, nil
}
