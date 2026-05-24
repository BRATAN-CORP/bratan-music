package authz

import "testing"

func TestSessionCrypto_RoundTrip(t *testing.T) {
	secret := "very-secret-aes-key"
	plain := `{"accessToken":"xyz","refresh":"abc"}`
	enc, err := EncryptSession(secret, plain)
	if err != nil {
		t.Fatalf("encrypt: %v", err)
	}
	got, err := DecryptSession(secret, enc)
	if err != nil {
		t.Fatalf("decrypt: %v", err)
	}
	if got != plain {
		t.Fatalf("round-trip mismatch: %s", got)
	}
}

func TestSessionCrypto_TamperFails(t *testing.T) {
	secret := "k"
	enc, _ := EncryptSession(secret, "hello")
	// Flip the last char of the ciphertext.
	bad := enc[:len(enc)-1] + "A"
	if _, err := DecryptSession(secret, bad); err == nil {
		t.Fatal("tampered ciphertext should fail")
	}
}

func TestSessionCrypto_DifferentKey(t *testing.T) {
	enc, _ := EncryptSession("k1", "hello")
	if _, err := DecryptSession("k2", enc); err == nil {
		t.Fatal("wrong key should fail")
	}
}
