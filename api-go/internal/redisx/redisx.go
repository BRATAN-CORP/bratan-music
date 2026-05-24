// Package redisx wraps go-redis with KV-style helpers that mirror the
// Cloudflare KV namespace API used throughout the legacy worker.
//
// Most call-sites in the original TS code only needed get / put-with-ttl /
// delete; we expose exactly those operations plus a few raw escape hatches
// for things like rate-limit counters and pub/sub.
package redisx

import (
	"context"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
)

// Client is a thin wrapper over the go-redis Client carrying convenience
// helpers we use across the codebase.
type Client struct {
	*redis.Client
}

// Open parses the connection URL and returns a connected client. We ping
// during startup so a bad URL fails fast instead of erroring out on the
// first user request.
func Open(ctx context.Context, url string) (*Client, error) {
	opts, err := redis.ParseURL(url)
	if err != nil {
		return nil, fmt.Errorf("redis parse url: %w", err)
	}
	cli := redis.NewClient(opts)

	pingCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if err := cli.Ping(pingCtx).Err(); err != nil {
		_ = cli.Close()
		return nil, fmt.Errorf("redis ping: %w", err)
	}
	return &Client{Client: cli}, nil
}

// KVGet returns the string value for key, or ("", false, nil) if missing.
func (c *Client) KVGet(ctx context.Context, key string) (string, bool, error) {
	v, err := c.Get(ctx, key).Result()
	if err == redis.Nil {
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}
	return v, true, nil
}

// KVSet writes value with the given TTL (use 0 for no expiry).
func (c *Client) KVSet(ctx context.Context, key, value string, ttl time.Duration) error {
	return c.Set(ctx, key, value, ttl).Err()
}

// KVDel removes a key. Missing keys are not an error.
func (c *Client) KVDel(ctx context.Context, key string) error {
	return c.Del(ctx, key).Err()
}

// IncrWithTTL atomically increments a counter and ensures a TTL is set.
// Used by the rate-limit middleware.
func (c *Client) IncrWithTTL(ctx context.Context, key string, ttl time.Duration) (int64, error) {
	pipe := c.TxPipeline()
	incr := pipe.Incr(ctx, key)
	pipe.Expire(ctx, key, ttl)
	if _, err := pipe.Exec(ctx); err != nil {
		return 0, err
	}
	return incr.Val(), nil
}
