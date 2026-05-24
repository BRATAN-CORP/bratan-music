// Package storage abstracts the S3-compatible object store the API uses
// for cover art, user uploads, and track-overrides. We talk to MinIO in
// production (see deploy/docker-compose.yml) but the same code works
// against any S3-compatible endpoint.
//
// Object keys are validated against the same regex the legacy worker used
// (`^[a-zA-Z0-9_-]{1,64}$`) to prevent path-traversal or weird-byte
// behaviour from Tidal track IDs ending up as filesystem-adjacent strings.
package storage

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"regexp"
	"time"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

var safeKey = regexp.MustCompile(`^[a-zA-Z0-9_-]{1,64}$`)

// Store wraps the MinIO client plus the configured bucket name.
type Store struct {
	cli    *minio.Client
	bucket string
	useSSL bool
}

// Open creates the client, ensures the bucket exists, and returns a handle.
func Open(ctx context.Context, endpoint string, port int, useSSL bool, access, secret, bucket string) (*Store, error) {
	addr := endpoint
	if port != 0 && port != 443 && port != 80 {
		addr = fmt.Sprintf("%s:%d", endpoint, port)
	}
	cli, err := minio.New(addr, &minio.Options{
		Creds:  credentials.NewStaticV4(access, secret, ""),
		Secure: useSSL,
	})
	if err != nil {
		return nil, fmt.Errorf("minio: %w", err)
	}
	s := &Store{cli: cli, bucket: bucket, useSSL: useSSL}
	if err := s.ensureBucket(ctx); err != nil {
		return nil, err
	}
	return s, nil
}

func (s *Store) ensureBucket(ctx context.Context) error {
	ok, err := s.cli.BucketExists(ctx, s.bucket)
	if err != nil {
		return fmt.Errorf("bucket exists: %w", err)
	}
	if !ok {
		if err := s.cli.MakeBucket(ctx, s.bucket, minio.MakeBucketOptions{}); err != nil {
			return fmt.Errorf("make bucket: %w", err)
		}
	}
	return nil
}

// IsSafeKey returns true if key matches the validated alphabet+length.
func IsSafeKey(key string) bool { return safeKey.MatchString(key) }

// Bucket returns the configured bucket name (handy for logs and URLs).
func (s *Store) Bucket() string { return s.bucket }

// Put writes an object. Caller is responsible for choosing a safe key.
func (s *Store) Put(ctx context.Context, key string, body io.Reader, size int64, contentType string) error {
	_, err := s.cli.PutObject(ctx, s.bucket, key, body, size, minio.PutObjectOptions{ContentType: contentType})
	return err
}

// PutBytes writes a small in-memory object. Convenience wrapper used by
// cover-art and avatar uploads.
func (s *Store) PutBytes(ctx context.Context, key string, body []byte, contentType string) error {
	return s.Put(ctx, key, bytes.NewReader(body), int64(len(body)), contentType)
}

// Get returns an object reader. Caller must Close() it.
func (s *Store) Get(ctx context.Context, key string) (io.ReadCloser, *minio.ObjectInfo, error) {
	obj, err := s.cli.GetObject(ctx, s.bucket, key, minio.GetObjectOptions{})
	if err != nil {
		return nil, nil, err
	}
	info, err := obj.Stat()
	if err != nil {
		_ = obj.Close()
		return nil, nil, err
	}
	return obj, &info, nil
}

// Delete removes an object. Missing objects are not an error.
func (s *Store) Delete(ctx context.Context, key string) error {
	return s.cli.RemoveObject(ctx, s.bucket, key, minio.RemoveObjectOptions{})
}

// PresignGet returns a short-lived GET URL. Used by the audio-stream proxy.
func (s *Store) PresignGet(ctx context.Context, key string, ttl time.Duration) (string, error) {
	u, err := s.cli.PresignedGetObject(ctx, s.bucket, key, ttl, nil)
	if err != nil {
		return "", err
	}
	return u.String(), nil
}
