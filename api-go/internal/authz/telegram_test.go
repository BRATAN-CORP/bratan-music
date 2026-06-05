package authz

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"testing"
	"time"
)

// signInitData produces a valid initData string for testing. Mirrors
// exactly the algorithm in VerifyInitData so a test failure means a
// real protocol mismatch, not a test bug.
func signInitData(botToken string, fields url.Values) string {
	keys := []string{}
	for k := range fields {
		if k != "hash" {
			keys = append(keys, k)
		}
	}
	sort.Strings(keys)
	parts := make([]string, 0, len(keys))
	for _, k := range keys {
		parts = append(parts, k+"="+fields.Get(k))
	}
	data := strings.Join(parts, "\n")

	secMac := hmac.New(sha256.New, []byte("WebAppData"))
	_, _ = secMac.Write([]byte(botToken))
	key := secMac.Sum(nil)
	check := hmac.New(sha256.New, key)
	_, _ = check.Write([]byte(data))
	fields.Set("hash", hex.EncodeToString(check.Sum(nil)))
	return fields.Encode()
}

func TestVerifyInitData_Valid(t *testing.T) {
	token := "1234567890:test-token"
	now := strconv.FormatInt(time.Now().Unix(), 10)
	fields := url.Values{
		"auth_date": []string{now},
		"user":      []string{`{"id":42,"first_name":"Test","username":"test"}`},
		"query_id":  []string{"qid-1"},
	}
	raw := signInitData(token, fields)
	out, err := VerifyInitData(token, raw, 24*time.Hour)
	if err != nil {
		t.Fatalf("expected pass, got %v", err)
	}
	if out.User.ID != 42 {
		t.Fatalf("user.id mismatch: %d", out.User.ID)
	}
}

func TestVerifyInitData_TamperedHash(t *testing.T) {
	token := "1234567890:test-token"
	now := strconv.FormatInt(time.Now().Unix(), 10)
	fields := url.Values{
		"auth_date": []string{now},
		"user":      []string{`{"id":42}`},
	}
	raw := signInitData(token, fields)
	// Flip one byte of the hash.
	raw = strings.Replace(raw, "hash=", "hash=ff", 1)
	if _, err := VerifyInitData(token, raw, 24*time.Hour); err == nil {
		t.Fatal("expected tampered hash to fail")
	}
}

func TestVerifyInitData_StaleAuthDate(t *testing.T) {
	token := "abc"
	old := strconv.FormatInt(time.Now().Add(-48*time.Hour).Unix(), 10)
	fields := url.Values{
		"auth_date": []string{old},
		"user":      []string{`{"id":1}`},
	}
	raw := signInitData(token, fields)
	if _, err := VerifyInitData(token, raw, 24*time.Hour); err == nil {
		t.Fatal("expected stale auth_date to fail")
	}
}

func TestVerifyWebhookSecret(t *testing.T) {
	if !VerifyWebhookSecret("secret-xyz", "secret-xyz") {
		t.Fatal("equal secrets should pass")
	}
	if VerifyWebhookSecret("secret-xyz", "secret-xy") {
		t.Fatal("differing secrets should fail")
	}
	if VerifyWebhookSecret("", "secret") {
		t.Fatal("empty expected should fail")
	}
}
