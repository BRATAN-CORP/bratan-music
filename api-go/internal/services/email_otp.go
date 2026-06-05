package services

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// OTPPurpose is the lifecycle role of an issued code.
//
// `login` codes back the unauthenticated /auth/email/{request,verify}
// flow that mints a fresh email-first user row or signs into an
// existing one. `link` codes back the authenticated
// /user/me/email/{request,verify} flow that attaches an email to a
// pre-existing Telegram user; the verify side refuses a `login` row
// submitted to `link` (and vice-versa) so a stolen `login` code can't
// be replayed to attach a fresh email address to a foreign account.
type OTPPurpose string

const (
	OTPPurposeLogin OTPPurpose = "login"
	OTPPurposeLink  OTPPurpose = "link"
)

// otpTTL is how long a freshly-issued code remains valid before the
// verify side rejects it as expired. Matches the legacy worker's
// 10-minute window.
const otpTTL = 10 * time.Minute

// otpResendCooldown is the minimum interval between two `request`
// calls for the same email. Keeps the Brevo bill predictable and
// shuts the trivial email-spam vector that a 1-call/sec script would
// otherwise open against the 300/day free plan.
const otpResendCooldown = 60 * time.Second

// otpMaxAttempts caps the number of wrong-code attempts before the
// row is hard-deleted and the user has to request a fresh code.
const otpMaxAttempts = 5

// IssueResult is what IssueCode hands back to the request handler.
// Returned when a fresh code was generated (callers must ship the
// plaintext via Brevo). `nil, nil` means "in-flight code still valid,
// cooldown blocks issuing a new one" — the caller should return the
// same opaque "ok" to the client to avoid leaking the rate-limit.
type IssueResult struct {
	Code      string
	ExpiresAt int64
}

// IssueCode generates a fresh 6-digit code, stores its SHA-256 hash
// keyed by email, and returns the plaintext to the caller. Re-issues
// for the same email replace the existing row in place (single-row
// per email) and reset `attempts`, so a verify-flooded row can be
// cleared by simply requesting again.
//
// Returns `(nil, nil)` when the previous code for this email is
// still within the resend-cooldown window AND has not expired —
// callers should pretend they sent a fresh one to avoid signalling
// the cooldown's existence.
func (s *EmailOtpService) IssueCode(ctx context.Context, email string, purpose OTPPurpose, userID *string) (*IssueResult, error) {
	email = NormalizeEmail(email)
	now := time.Now().Unix()

	var existingCreated, existingExpires int64
	err := s.A.DB.QueryRow(ctx,
		`SELECT created_at, expires_at FROM email_otps WHERE email = $1`, email,
	).Scan(&existingCreated, &existingExpires)
	switch {
	case err == nil:
		if existingCreated+int64(otpResendCooldown/time.Second) > now && existingExpires > now {
			return nil, nil
		}
	case errors.Is(err, pgx.ErrNoRows):
		// nothing to gate on, fall through.
	default:
		return nil, err
	}

	code, err := generateOTPCode()
	if err != nil {
		return nil, err
	}
	codeHash := sha256Hex(code)
	expiresAt := now + int64(otpTTL/time.Second)

	// UPSERT — single-row-per-email keeps the verify path O(1) and
	// stops an attacker from drowning the table with codes for
	// random addresses.
	var uidArg any
	if userID != nil && *userID != "" {
		uidArg = *userID
	} else {
		uidArg = nil
	}
	if _, err := s.A.DB.Exec(ctx,
		`INSERT INTO email_otps (email, code_hash, purpose, user_id, attempts, expires_at, created_at)
		     VALUES ($1, $2, $3, $4, 0, $5, $6)
		     ON CONFLICT(email) DO UPDATE SET
		       code_hash = EXCLUDED.code_hash,
		       purpose = EXCLUDED.purpose,
		       user_id = EXCLUDED.user_id,
		       attempts = 0,
		       expires_at = EXCLUDED.expires_at,
		       created_at = EXCLUDED.created_at`,
		email, codeHash, string(purpose), uidArg, expiresAt, now,
	); err != nil {
		return nil, err
	}

	return &IssueResult{Code: code, ExpiresAt: expiresAt}, nil
}

// VerifyOutcome distinguishes the user-visible failure modes.
type VerifyOutcome string

const (
	VerifyOK       VerifyOutcome = "ok"
	VerifyExpired  VerifyOutcome = "expired"
	VerifyWrong    VerifyOutcome = "wrong"
	VerifyMissing  VerifyOutcome = "missing"
	VerifyPurpose  VerifyOutcome = "purpose"
)

// VerifyResult is what VerifyCode hands back. UserID is set only on
// success and only when the original IssueCode call attached one
// (the `link` flow); fresh logins issue with `userID = nil`.
type VerifyResult struct {
	Outcome VerifyOutcome
	UserID  string
}

// VerifyCode constant-time-compares the submitted code's hash to the
// stored hash, drops the row on success, increments `attempts` on a
// wrong code, and hard-deletes after otpMaxAttempts to force a fresh
// request. Purpose mismatch returns `purpose` WITHOUT bumping
// `attempts` — the user can't influence purpose from the client, so
// counting it would just brick legitimate flows on a bug.
func (s *EmailOtpService) VerifyCode(ctx context.Context, email, code string, purpose OTPPurpose) (*VerifyResult, error) {
	email = NormalizeEmail(email)
	now := time.Now().Unix()

	var (
		storedHash    string
		storedPurpose string
		userID        *string
		attempts      int
		expiresAt     int64
	)
	err := s.A.DB.QueryRow(ctx,
		`SELECT code_hash, purpose, user_id, attempts, expires_at
		   FROM email_otps WHERE email = $1`, email,
	).Scan(&storedHash, &storedPurpose, &userID, &attempts, &expiresAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return &VerifyResult{Outcome: VerifyMissing}, nil
	}
	if err != nil {
		return nil, err
	}
	if expiresAt <= now {
		_, _ = s.A.DB.Exec(ctx, `DELETE FROM email_otps WHERE email = $1`, email)
		return &VerifyResult{Outcome: VerifyExpired}, nil
	}
	if storedPurpose != string(purpose) {
		return &VerifyResult{Outcome: VerifyPurpose}, nil
	}
	submittedHash := sha256Hex(code)
	if !constantTimeHexEqual(submittedHash, storedHash) {
		next := attempts + 1
		if next >= otpMaxAttempts {
			_, _ = s.A.DB.Exec(ctx, `DELETE FROM email_otps WHERE email = $1`, email)
		} else {
			_, _ = s.A.DB.Exec(ctx,
				`UPDATE email_otps SET attempts = $1 WHERE email = $2`, next, email)
		}
		return &VerifyResult{Outcome: VerifyWrong}, nil
	}
	// Single-use — drop the row before the caller mints tokens / attaches
	// the email so the same code can never be replayed.
	_, _ = s.A.DB.Exec(ctx, `DELETE FROM email_otps WHERE email = $1`, email)
	uid := ""
	if userID != nil {
		uid = *userID
	}
	return &VerifyResult{Outcome: VerifyOK, UserID: uid}, nil
}

// Sweep removes expired rows. Called best-effort from the request
// handler so the table stays small without paying for a dedicated
// cron entry. LIMIT 100 keeps the operation cheap on busy days.
func (s *EmailOtpService) Sweep(ctx context.Context) {
	now := time.Now().Unix()
	_, _ = s.A.DB.Exec(ctx,
		`DELETE FROM email_otps
		   WHERE email IN (
		     SELECT email FROM email_otps WHERE expires_at <= $1 LIMIT 100
		   )`, now)
}

// ---- helpers shared by handlers --------------------------------------

// NormalizeEmail lowercases and trims an email. Brevo doesn't care
// about case in the local part of a Gmail address but most SMTP
// servers do — normalising on store means "Foo@Bar.Com" and
// "foo@bar.com" map to the same row. Spec-wise the local part is
// case-sensitive per RFC 5321; the world disagrees so we follow
// what every major provider actually does.
func NormalizeEmail(email string) string {
	return strings.ToLower(strings.TrimSpace(email))
}

// IsPlausibleEmail rejects things obviously not addresses. RFC 5322
// is gnarly; the canonical deliverability check is "did the OTP code
// come back". This filter is just a fast gate against junk before
// Brevo's relay even sees it.
func IsPlausibleEmail(email string) bool {
	trimmed := strings.TrimSpace(email)
	if trimmed == "" || len(trimmed) > 254 {
		return false
	}
	if strings.ContainsAny(trimmed, " \t\r\n") {
		return false
	}
	at := strings.Index(trimmed, "@")
	if at <= 0 || at != strings.LastIndex(trimmed, "@") || at == len(trimmed)-1 {
		return false
	}
	domain := trimmed[at+1:]
	if !strings.Contains(domain, ".") || strings.HasPrefix(domain, ".") || strings.HasSuffix(domain, ".") {
		return false
	}
	return true
}

// IsDisposableEmail returns true when the address's domain is on the
// hand-curated blocklist of temp-mail / disposable-inbox providers.
// The list trades coverage for false-positive safety — only domains
// we've actually seen as scraper-grade temp-mail surface make it in,
// so real users on Gmail / Yandex / Outlook / iCloud are never
// affected.
func IsDisposableEmail(email string) bool {
	at := strings.LastIndex(email, "@")
	if at <= 0 {
		return false
	}
	domain := strings.ToLower(strings.TrimSpace(email[at+1:]))
	if domain == "" {
		return false
	}
	if _, ok := disposableEmailDomains[domain]; ok {
		return true
	}
	// Catch obvious sub-domain variants of multi-label bases (so
	// e.g. "x.mail.tm" inherits the mail.tm gate).
	for base := range disposableEmailDomains {
		if strings.Contains(base, ".") && strings.HasSuffix(domain, "."+base) {
			return true
		}
	}
	return false
}

// disposableEmailDomains is the curated blocklist. Mirrors
// worker/services/EmailOtpService.ts DISPOSABLE_EMAIL_DOMAINS.
var disposableEmailDomains = map[string]struct{}{
	// mail.tm + sister domains.
	"mail.tm": {}, "wshu.net": {}, "edny.net": {}, "rover.info": {}, "tiden.org": {},
	"tippsy.org": {}, "oranek.com": {}, "wireconnected.com": {}, "bingobongoo.fun": {},
	// Mailinator family.
	"mailinator.com": {}, "mailinator.net": {}, "mailinator.org": {}, "mailinator2.com": {},
	"binkmail.com": {}, "safetymail.info": {}, "sogetthis.com": {}, "spamherelots.com": {},
	"spamhereplease.com": {}, "thisisnotmyrealemail.com": {}, "tradermail.info": {},
	"veryrealemail.com": {}, "zippymail.info": {}, "mailinator.gq": {}, "reallymymail.com": {},
	// GuerrillaMail family.
	"guerrillamail.com": {}, "guerrillamail.org": {}, "guerrillamail.net": {},
	"guerrillamail.biz": {}, "guerrillamailblock.com": {}, "sharklasers.com": {},
	"grr.la": {}, "spam4.me": {}, "pokemail.net": {}, "guerrillamail.de": {},
	// 10minutemail / variants.
	"10minutemail.com": {}, "10minutemail.net": {}, "10minemail.com": {},
	"20minutemail.com": {}, "30minutemail.com": {}, "60minutemail.com": {},
	// tempmail / temp-mail family.
	"tempmail.com": {}, "temp-mail.org": {}, "temp-mail.io": {}, "tempmail.dev": {},
	"tempmailer.com": {}, "tempmailo.com": {}, "tempr.email": {}, "temp-link.net": {},
	"discard.email": {}, "discardmail.com": {}, "discardmail.de": {},
	// YOPmail family.
	"yopmail.com": {}, "yopmail.fr": {}, "yopmail.net": {}, "cool.fr.nf": {}, "jetable.fr.nf": {},
	"nospam.ze.tc": {}, "nomail.xl.cx": {}, "mega.zik.dj": {}, "speed.1s.fr": {},
	"courriel.fr.nf": {}, "moncourrier.fr.nf": {}, "monemail.fr.nf": {}, "monmail.fr.nf": {},
	// throwawaymail / fakeinbox.
	"throwawaymail.com": {}, "fakeinbox.com": {}, "mintemail.com": {}, "mt2014.com": {},
	"mt2015.com": {}, "mytemp.email": {}, "smashmail.de": {}, "spamgourmet.com": {},
	// dispostable / others.
	"dispostable.com": {}, "mailnesia.com": {}, "mailcatch.com": {}, "maildrop.cc": {},
	"getairmail.com": {}, "spambox.us": {}, "mvrht.net": {}, "mvrht.com": {},
	// emailondeck / muleemail / mohmal / inboxbear.
	"emailondeck.com": {}, "muleemail.com": {}, "mohmal.com": {}, "inboxbear.com": {},
	"mohmal.in": {}, "inboxkitten.com": {}, "rcpt.at": {},
	// burnermail.io + family.
	"burnermail.io": {}, "tmpmail.org": {}, "tmpmail.net": {}, "tmpeml.com": {},
	// simpleinbox / luxusmail / fakemail / generator.email.
	"simpleinbox.com": {}, "fakemail.fr": {}, "fakemail.net": {}, "generator.email": {},
	"mailfa.tk": {}, "getnada.com": {}, "nada.email": {}, "getmail.tools": {},
}

// generateOTPCode draws 6 independent decimal digits from crypto/rand.
// Six fresh draws keeps the guess probability at a flat 1-in-10⁶,
// which with otpMaxAttempts=5 caps brute-force at 1-in-2·10⁵ per
// issued code — fine for a 10-minute TTL.
func generateOTPCode() (string, error) {
	var buf [6]byte
	if _, err := rand.Read(buf[:]); err != nil {
		return "", err
	}
	out := make([]byte, 6)
	for i := 0; i < 6; i++ {
		// Modulo bias is negligible at modulus 10 over a uniform u8.
		out[i] = '0' + (buf[i] % 10)
	}
	return string(out), nil
}

func sha256Hex(s string) string {
	sum := sha256.Sum256([]byte(s))
	return hex.EncodeToString(sum[:])
}

// constantTimeHexEqual compares two equal-length hex strings without
// short-circuiting on the first mismatched character. Both inputs in
// this package are 64-char SHA-256 digests; the length guard is
// defence-in-depth for future callers.
func constantTimeHexEqual(a, b string) bool {
	if len(a) != len(b) {
		return false
	}
	var diff byte
	for i := 0; i < len(a); i++ {
		diff |= a[i] ^ b[i]
	}
	return diff == 0
}
