package authz

import "testing"

func TestSessionRoundTrip(t *testing.T) {
	secret := "a-reasonably-long-secret-value"
	plain := "tidal-access-token-payload.sig"
	enc, err := EncryptSession(secret, plain)
	if err != nil {
		t.Fatalf("encrypt: %v", err)
	}
	if enc == plain {
		t.Fatalf("ciphertext equals plaintext")
	}
	if got := enc[:7]; got != encPrefix {
		t.Fatalf("missing enc:v1: prefix, got %q", got)
	}
	got, err := DecryptSession(secret, enc)
	if err != nil {
		t.Fatalf("decrypt: %v", err)
	}
	if got != plain {
		t.Fatalf("round trip mismatch: %q != %q", got, plain)
	}
}

func TestDecryptTamperedFails(t *testing.T) {
	secret := "a-reasonably-long-secret-value"
	enc, _ := EncryptSession(secret, "hello")
	bad := enc[:len(enc)-2] + "00"
	if _, err := DecryptSession(secret, bad); err == nil {
		t.Fatalf("expected error on tampered ciphertext")
	}
}

func TestDecryptWrongKeyFails(t *testing.T) {
	enc, _ := EncryptSession("key-one-aaaaaaaa", "hello")
	if _, err := DecryptSession("key-two-bbbbbbbb", enc); err == nil {
		t.Fatalf("expected error decrypting with wrong key")
	}
}

func TestLegacyPlaintextPassthrough(t *testing.T) {
	// Rows without the enc:v1: prefix are legacy plaintext and must be
	// returned verbatim (matches the worker's fallback).
	got, err := DecryptSession("any-key", "raw-plaintext-token")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got != "raw-plaintext-token" {
		t.Fatalf("plaintext passthrough mismatch: %q", got)
	}
}

// TestDecryptWorkerFixture decrypts a blob produced INDEPENDENTLY with
// the same algorithm as worker/src/services/tidal/sessionCrypto.ts
// (AES-256-GCM, SHA-256(secret) key, 12-byte IV, URL-safe base64 no
// padding, ciphertext‖tag). This guards the cross-backend compatibility
// of the shared `tidal_session` row — the bug that would have killed
// streaming after the Go cut-over.
func TestDecryptWorkerFixture(t *testing.T) {
	const (
		secret = "test-secret-key-1234567890"
		want   = "tidal-access-token-XYZ.payload.sig"
		blob   = "enc:v1:2wLbqj_M_5QVmHSE:wi07IarcDUJNhrcIq4YtD59CRZreRIVUahIvn1eNDdDd9JxeI1lRSR7kqG1VhXBC9ZA"
	)
	got, err := DecryptSession(secret, blob)
	if err != nil {
		t.Fatalf("decrypt worker fixture: %v", err)
	}
	if got != want {
		t.Fatalf("worker fixture mismatch: %q != %q", got, want)
	}
}
