package authz

import (
	"testing"
)

func TestSignAndVerify_RoundTrip(t *testing.T) {
	secret := "test-secret-please-change"
	tok, _, err := SignAccess(secret, "user-42", true, "sess-1")
	if err != nil {
		t.Fatalf("sign: %v", err)
	}
	c, err := Verify(secret, tok)
	if err != nil {
		t.Fatalf("verify: %v", err)
	}
	if c.Subject != "user-42" || !c.Admin || c.SID != "sess-1" {
		t.Fatalf("claims mismatch: %+v", c)
	}
}

func TestVerify_WrongSecret(t *testing.T) {
	tok, _, _ := SignAccess("right", "u", false, "")
	if _, err := Verify("wrong", tok); err == nil {
		t.Fatal("expected wrong-secret to fail")
	}
}

func TestSplitBearer(t *testing.T) {
	cases := map[string]string{
		"Bearer abc": "abc",
		"bearer xyz": "xyz",
		"":           "",
		"abc":        "",
		"Bearer ":    "",
	}
	for in, want := range cases {
		if got := SplitBearer(in); got != want {
			t.Fatalf("SplitBearer(%q) = %q want %q", in, got, want)
		}
	}
}

func TestHashRefresh_Stable(t *testing.T) {
	if HashRefresh("abc") == HashRefresh("abd") {
		t.Fatal("different inputs should not hash equal")
	}
	if HashRefresh("abc") != HashRefresh("abc") {
		t.Fatal("stable input should hash equal")
	}
}
