package services

import "testing"

func TestNormalizeEmail(t *testing.T) {
	cases := map[string]string{
		"  Foo@Bar.Com ":     "foo@bar.com",
		"USER@example.org":   "user@example.org",
		"already.lower@x.io": "already.lower@x.io",
		"":                   "",
	}
	for in, want := range cases {
		got := NormalizeEmail(in)
		if got != want {
			t.Errorf("NormalizeEmail(%q) = %q; want %q", in, got, want)
		}
	}
}

func TestIsPlausibleEmail(t *testing.T) {
	good := []string{
		"a@b.co",
		"user.name+tag@sub.example.com",
		"x@y.io",
	}
	bad := []string{
		"",
		"   ",
		"foo",
		"@bar.com",
		"foo@",
		"foo@bar",
		"foo bar@x.io",
		"a@@b.co",
		"a@.b.co",
		"a@b.co.",
	}
	for _, e := range good {
		if !IsPlausibleEmail(e) {
			t.Errorf("IsPlausibleEmail(%q) = false; want true", e)
		}
	}
	for _, e := range bad {
		if IsPlausibleEmail(e) {
			t.Errorf("IsPlausibleEmail(%q) = true; want false", e)
		}
	}
}

func TestIsDisposableEmail(t *testing.T) {
	disposable := []string{
		"foo@mail.tm",
		"foo@FOO.mail.tm",
		"x@mailinator.com",
		"x@guerrillamail.org",
		"x@10minutemail.com",
		"x@yopmail.com",
		"x@tempr.email",
	}
	real := []string{
		"x@gmail.com",
		"x@yandex.ru",
		"x@icloud.com",
		"x@outlook.com",
		"x@example.com",
	}
	for _, e := range disposable {
		if !IsDisposableEmail(e) {
			t.Errorf("IsDisposableEmail(%q) = false; want true", e)
		}
	}
	for _, e := range real {
		if IsDisposableEmail(e) {
			t.Errorf("IsDisposableEmail(%q) = true; want false", e)
		}
	}
}

func TestGenerateOTPCode(t *testing.T) {
	for i := 0; i < 20; i++ {
		c, err := generateOTPCode()
		if err != nil {
			t.Fatalf("generateOTPCode err: %v", err)
		}
		if len(c) != 6 {
			t.Fatalf("len = %d; want 6", len(c))
		}
		for _, b := range []byte(c) {
			if b < '0' || b > '9' {
				t.Fatalf("non-digit %c in code %q", b, c)
			}
		}
	}
}

func TestConstantTimeHexEqual(t *testing.T) {
	a := "abc123"
	b := "abc123"
	c := "abc124"
	d := "abc12"
	if !constantTimeHexEqual(a, b) {
		t.Error("equal strings reported unequal")
	}
	if constantTimeHexEqual(a, c) {
		t.Error("differing strings reported equal")
	}
	if constantTimeHexEqual(a, d) {
		t.Error("different-length strings reported equal")
	}
}

func TestSHA256Hex(t *testing.T) {
	// sha256("") in hex
	want := "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
	if got := sha256Hex(""); got != want {
		t.Errorf("sha256Hex(\"\") = %q; want %q", got, want)
	}
}
