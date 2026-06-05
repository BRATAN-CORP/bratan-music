package services

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// brevoEndpoint is the transactional-email REST endpoint. Brevo's
// SMTP relay can't be hit from Cloudflare Workers (no raw TCP), so
// the legacy worker uses this same API; we keep the surface for
// parity even though the Go port could technically open SMTP.
const brevoEndpoint = "https://api.brevo.com/v3/smtp/email"

// brevoTimeout caps the per-send HTTP round-trip. Brevo's median
// latency is sub-second; anything longer than 15s is almost
// certainly an upstream stall and we'd rather surface "не удалось
// отправить" than block the request thread.
const brevoTimeout = 15 * time.Second

// Locale picks the OTP-email body language. We only split RU vs EN
// because the code itself is the payload; everything else is fluff.
type Locale string

const (
	LocaleRU Locale = "ru"
	LocaleEN Locale = "en"
)

// SendOTP ships a one-time code to `to`. Returns true when Brevo's
// API accepted the message (2xx); false otherwise. The error log
// captures the upstream status for ops; the caller intentionally
// surfaces an opaque "ok" or "не удалось" to clients to avoid
// leaking account-enumeration signal via timing.
func (s *BrevoService) SendOTP(ctx context.Context, to, code string, locale Locale) bool {
	apiKey := s.A.Cfg.BrevoAPIKey
	senderEmail := s.A.Cfg.BrevoSenderEmail
	senderName := s.A.Cfg.BrevoSenderName
	if senderName == "" {
		senderName = "BRATAN MUSIC"
	}
	if apiKey == "" || senderEmail == "" {
		s.A.Logger.Error("[brevo] missing BREVO_API_KEY or BREVO_SENDER_EMAIL — refusing to send")
		return false
	}

	subject := fmt.Sprintf("%s — код для входа", code)
	if locale == LocaleEN {
		subject = fmt.Sprintf("%s — your sign-in code", code)
	}

	payload := map[string]any{
		"sender": map[string]string{
			"email": senderEmail,
			"name":  senderName,
		},
		"to": []map[string]string{
			{"email": to},
		},
		"subject":     subject,
		"htmlContent": brevoRenderOTPHTML(code, locale),
		"textContent": brevoRenderOTPText(code, locale),
	}
	body, err := json.Marshal(payload)
	if err != nil {
		s.A.Logger.Error("[brevo] marshal failed", "err", err)
		return false
	}

	reqCtx, cancel := context.WithTimeout(ctx, brevoTimeout)
	defer cancel()

	req, err := http.NewRequestWithContext(reqCtx, http.MethodPost, brevoEndpoint, bytes.NewReader(body))
	if err != nil {
		s.A.Logger.Error("[brevo] build request failed", "err", err)
		return false
	}
	req.Header.Set("accept", "application/json")
	req.Header.Set("api-key", apiKey)
	req.Header.Set("content-type", "application/json")

	res, err := http.DefaultClient.Do(req)
	if err != nil {
		s.A.Logger.Error("[brevo] send failed", "err", err)
		return false
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		buf, _ := io.ReadAll(io.LimitReader(res.Body, 512))
		s.A.Logger.Error("[brevo] upstream rejected",
			"status", res.StatusCode,
			"body", string(buf))
		return false
	}
	return true
}

// brevoStrings is the per-locale copy used by the OTP template. Kept
// inline (vs a translation table) because the surface is tiny and
// adding a third locale would need a UI rev anyway.
type brevoStrings struct {
	Preheader       string
	Eyebrow         string
	Greeting        string
	Intro           string
	CodeLabel       string
	TTL             string
	Ignore          string
	Security        string
	FooterTagline   string
	FooterCopyright string
	FooterAuto      string
}

func brevoStringsFor(locale Locale) brevoStrings {
	if locale == LocaleEN {
		return brevoStrings{
			Preheader:       "Your sign-in code expires in 10 minutes.",
			Eyebrow:         "Sign in",
			Greeting:        "Your sign-in code",
			Intro:           "Enter the code below on the sign-in screen to access BRATAN MUSIC.",
			CodeLabel:       "One-time code",
			TTL:             "Valid for 10 minutes",
			Ignore:          "Did not ask for this code? You can safely ignore this email — your account stays secure.",
			Security:        "For your security, never share this code with anyone. BRATAN MUSIC will never ask for it.",
			FooterTagline:   "Streaming without compromise",
			FooterCopyright: "© BRATAN MUSIC. All rights reserved.",
			FooterAuto:      "This is an automated message, please do not reply.",
		}
	}
	return brevoStrings{
		Preheader:       "Код для входа действует 10 минут.",
		Eyebrow:         "Вход",
		Greeting:        "Ваш код для входа",
		Intro:           "Введите код ниже на экране входа, чтобы открыть BRATAN MUSIC.",
		CodeLabel:       "Одноразовый код",
		TTL:             "Действует 10 минут",
		Ignore:          "Не запрашивали код? Просто проигнорируйте это письмо — аккаунт в безопасности.",
		Security:        "В целях безопасности не передавайте этот код никому. BRATAN MUSIC никогда не запрашивает его.",
		FooterTagline:   "Стриминг без компромиссов",
		FooterCopyright: "© BRATAN MUSIC. Все права защищены.",
		FooterAuto:      "Это автоматическое письмо, пожалуйста, не отвечайте на него.",
	}
}

func brevoRenderOTPText(code string, locale Locale) string {
	s := brevoStringsFor(locale)
	return strings.Join([]string{
		"BRATAN MUSIC — " + s.Eyebrow,
		"",
		s.Greeting + ": " + code,
		s.TTL + ".",
		"",
		s.Intro,
		"",
		s.Security,
		s.Ignore,
		"",
		"—",
		s.FooterTagline,
		s.FooterAuto,
	}, "\n")
}

// brevoRenderOTPHTML builds the dark-mode card the user opens in
// Gmail / Mail.app / Outlook. Constraints:
//
//   - Every style is inline. Gmail strips `<style>` in some viewers.
//   - No CSS custom properties — literal hex values mirror the in-app
//     dark palette from src/styles/_tokens.scss.
//   - No flexbox / grid — Outlook 2007-2019 (Word engine) doesn't
//     understand them. Layout is nested tables.
//   - Hidden preheader so the inbox preview reads as a tagline
//     instead of leaking the OTP digits next to the subject.
func brevoRenderOTPHTML(code string, locale Locale) string {
	s := brevoStringsFor(locale)

	const (
		accent      = "#7E89E8"
		subAccent   = "#f472b6"
		bg          = "#0a0a0c"
		surface     = "#111114"
		surfaceElev = "#16161a"
		border      = "#26262b"
		fg          = "#fafafa"
		fgMuted     = "#bdbdc4"
		fgFaint     = "#7a7a82"
	)

	return `<!doctype html>
<html lang="` + string(locale) + `"><head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="dark light">
  <meta name="supported-color-schemes" content="dark light">
  <title>` + escapeHTML(s.Greeting) + `</title>
</head>
<body style="margin:0;padding:0;background:` + bg + `;color:` + fg + `;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Helvetica Neue',Arial,sans-serif;-webkit-font-smoothing:antialiased;">
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:` + bg + `;opacity:0;">
    ` + escapeHTML(s.Preheader) + `
  </div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:` + bg + `;">
    <tr>
      <td align="center" style="padding:48px 16px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;width:100%;background:` + surface + `;border:1px solid ` + border + `;border-radius:20px;overflow:hidden;">
          <tr>
            <td style="padding:0;background:` + surface + `;background-image:radial-gradient(110% 110% at 0% 0%, ` + accent + `26 0%, transparent 55%), radial-gradient(120% 100% at 100% 100%, ` + subAccent + `1f 0%, transparent 60%);">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="padding:36px 36px 8px 36px;">
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td style="padding-right:12px;vertical-align:middle;">
                          <span style="display:inline-block;width:36px;height:36px;border-radius:10px;background:linear-gradient(135deg, ` + accent + ` 0%, ` + subAccent + ` 100%);text-align:center;line-height:36px;vertical-align:middle;">
                            <span style="display:inline-block;color:#0a0a0c;font-size:18px;font-weight:700;letter-spacing:0;">♪</span>
                          </span>
                        </td>
                        <td style="vertical-align:middle;">
                          <div style="font-size:15px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;color:` + fg + `;">BRATAN MUSIC</div>
                          <div style="font-size:11px;letter-spacing:0.22em;text-transform:uppercase;color:` + accent + `;margin-top:2px;">` + escapeHTML(s.Eyebrow) + `</div>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td style="padding:24px 36px 0 36px;">
              <h1 style="margin:0;font-size:22px;line-height:1.3;font-weight:600;letter-spacing:-0.01em;color:` + fg + `;">
                ` + escapeHTML(s.Greeting) + `
              </h1>
              <p style="margin:12px 0 0 0;font-size:14px;line-height:1.55;color:` + fgMuted + `;">
                ` + escapeHTML(s.Intro) + `
              </p>
            </td>
          </tr>

          <tr>
            <td style="padding:28px 36px 0 36px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:` + surfaceElev + `;border:1px solid ` + border + `;border-radius:16px;background-image:radial-gradient(120% 100% at 50% 0%, ` + accent + `1a 0%, transparent 70%);">
                <tr>
                  <td align="center" style="padding:22px 16px 22px 16px;">
                    <div style="font-size:11px;letter-spacing:0.22em;text-transform:uppercase;color:` + fgMuted + `;margin-bottom:10px;">` + escapeHTML(s.CodeLabel) + `</div>
                    <div style="font-family:'SF Mono','Menlo','Monaco','Consolas',monospace;font-size:36px;font-weight:700;letter-spacing:0.36em;color:` + fg + `;line-height:1;">
                      ` + escapeHTML(code) + `
                    </div>
                    <div style="font-size:12px;color:` + accent + `;margin-top:14px;letter-spacing:0.04em;">
                      ` + escapeHTML(s.TTL) + `
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td style="padding:24px 36px 4px 36px;">
              <p style="margin:0;font-size:13px;line-height:1.55;color:` + fgMuted + `;">
                ` + escapeHTML(s.Security) + `
              </p>
              <p style="margin:14px 0 0 0;font-size:13px;line-height:1.55;color:` + fgFaint + `;">
                ` + escapeHTML(s.Ignore) + `
              </p>
            </td>
          </tr>

          <tr><td style="padding:28px 36px 0 36px;"><div style="height:1px;background:` + border + `;line-height:1px;font-size:1px;">&nbsp;</div></td></tr>

          <tr>
            <td style="padding:18px 36px 32px 36px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="padding-right:10px;vertical-align:middle;">
                    <span style="display:inline-block;width:6px;height:6px;border-radius:6px;background:` + accent + `;vertical-align:middle;"></span>
                  </td>
                  <td style="vertical-align:middle;">
                    <div style="font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:` + accent + `;">BRATAN MUSIC</div>
                  </td>
                </tr>
              </table>
              <div style="margin-top:8px;font-size:13px;font-weight:500;color:` + fg + `;letter-spacing:-0.005em;">
                ` + escapeHTML(s.FooterTagline) + `
              </div>
              <div style="margin-top:14px;font-size:11px;line-height:1.6;color:` + fgFaint + `;">
                ` + escapeHTML(s.FooterCopyright) + `<br>
                ` + escapeHTML(s.FooterAuto) + `
              </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body></html>`
}

// escapeHTML escapes the five chars that matter inside an HTML
// attribute or text node. Mirrors worker/BrevoEmailService.escapeHtml.
func escapeHTML(s string) string {
	r := strings.NewReplacer(
		"&", "&amp;",
		"<", "&lt;",
		">", "&gt;",
		`"`, "&quot;",
		"'", "&#39;",
	)
	return r.Replace(s)
}
