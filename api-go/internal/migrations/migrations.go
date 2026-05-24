// Package migrations applies the SQL files shipped with the repo to the
// Postgres database. We deliberately reuse the existing worker/init-db
// schema and worker/src/db/migrations/* files instead of reinventing a Go
// migration set — keeping schema authorship in plain SQL means humans (and
// future agents) can read and modify the same files they already know.
package migrations

import (
	"context"
	"crypto/sha256"
	"embed"
	"encoding/hex"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
)

//go:embed sql/*.sql
var embedded embed.FS

// Apply runs every migration in the embedded set followed by any extra
// migrations found in the on-disk directory (used in development when
// schema files live under worker/src/db/migrations/ and we don't want a
// recompile cycle just to test a SQL change).
//
// Migrations are recorded in the `d1_migrations` table to stay
// compatible with whatever the legacy worker wrote during the original
// D1→PG conversion.
func Apply(ctx context.Context, pool *pgxpool.Pool, extraDir string) error {
	if err := ensureTable(ctx, pool); err != nil {
		return err
	}

	files, err := collect(extraDir)
	if err != nil {
		return err
	}

	for _, f := range files {
		applied, err := isApplied(ctx, pool, f.name, f.sum)
		if err != nil {
			return err
		}
		if applied {
			continue
		}
		slog.Info("applying migration", "name", f.name, "bytes", len(f.body))
		if err := apply(ctx, pool, f); err != nil {
			return fmt.Errorf("migration %s: %w", f.name, err)
		}
	}
	return nil
}

type migration struct {
	name string
	body []byte
	sum  string
}

func collect(extraDir string) ([]migration, error) {
	var out []migration

	// Embedded init schema(s) — always applied first.
	entries, err := embedded.ReadDir("sql")
	if err != nil {
		return nil, fmt.Errorf("read embedded migrations: %w", err)
	}
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".sql") {
			continue
		}
		body, err := embedded.ReadFile("sql/" + e.Name())
		if err != nil {
			return nil, err
		}
		out = append(out, migration{
			name: "embed:" + e.Name(),
			body: body,
			sum:  hash(body),
		})
	}

	// Extra migrations from disk (legacy worker D1 migrations, etc.).
	if extraDir != "" {
		if info, err := os.Stat(extraDir); err == nil && info.IsDir() {
			disk, err := os.ReadDir(extraDir)
			if err != nil {
				return nil, err
			}
			names := []string{}
			for _, e := range disk {
				if !e.IsDir() && strings.HasSuffix(e.Name(), ".sql") {
					names = append(names, e.Name())
				}
			}
			sort.Strings(names)
			for _, n := range names {
				body, err := os.ReadFile(filepath.Join(extraDir, n))
				if err != nil {
					return nil, err
				}
				out = append(out, migration{
					name: "disk:" + n,
					body: body,
					sum:  hash(body),
				})
			}
		}
	}

	return out, nil
}

func hash(b []byte) string {
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}

func ensureTable(ctx context.Context, pool *pgxpool.Pool) error {
	_, err := pool.Exec(ctx, `
		CREATE TABLE IF NOT EXISTS d1_migrations (
			id         SERIAL PRIMARY KEY,
			name       TEXT UNIQUE,
			applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
		)`)
	return err
}

func isApplied(ctx context.Context, pool *pgxpool.Pool, name, sum string) (bool, error) {
	_ = sum // we don't track checksums to remain compatible with the
	// existing schema; idempotency is achieved via name uniqueness +
	// `IF NOT EXISTS` clauses in the SQL itself.
	var got string
	err := pool.QueryRow(ctx, `SELECT name FROM d1_migrations WHERE name = $1`, name).Scan(&got)
	if err != nil {
		if strings.Contains(err.Error(), "no rows") {
			return false, nil
		}
		return false, err
	}
	return true, nil
}

func apply(ctx context.Context, pool *pgxpool.Pool, m migration) error {
	conn, err := pool.Acquire(ctx)
	if err != nil {
		return err
	}
	defer conn.Release()

	tx, err := conn.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	if _, err := tx.Exec(ctx, string(m.body)); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `INSERT INTO d1_migrations(name) VALUES ($1)
		ON CONFLICT (name) DO NOTHING`, m.name); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
