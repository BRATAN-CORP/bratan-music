import type { Env } from '../types/env';

/**
 * Brevo (ex-Sendinblue) transactional sender. Hits Brevo's REST API
 * over HTTPS — Cloudflare Workers can't open raw TCP/SMTP, so the
 * SMTP host (smtp-relay.brevo.com:587) is irrelevant; we use the
 * `xkeysib-…` API key against `https://api.brevo.com/v3/smtp/email`.
 *
 * Sender (`BREVO_SENDER_EMAIL`) must be a verified single-sender or a
 * sender on a verified domain — Brevo rejects anything else with
 * 401. We don't ship a domain on the free tier, so the sender email
 * is the same gmail the Brevo account was registered with.
 *
 * Failures are intentionally swallowed at the service edge: the OTP
 * gateway returns an opaque "ok" to clients regardless of upstream
 * outcome to avoid leaking which addresses exist on the platform
 * (account-enumeration), and we log to console so wrangler tail still
 * sees it.
 */
export class BrevoEmailService {
  constructor(private env: Env) {}

  async sendOtp(opts: { to: string; code: string; locale: 'ru' | 'en' }): Promise<boolean> {
    const apiKey = this.env.BREVO_API_KEY;
    const senderEmail = this.env.BREVO_SENDER_EMAIL;
    const senderName = this.env.BREVO_SENDER_NAME ?? 'BRATAN MUSIC';
    if (!apiKey || !senderEmail) {
      console.error('[Brevo] missing BREVO_API_KEY or BREVO_SENDER_EMAIL — refusing to send');
      return false;
    }

    const subject = opts.locale === 'en' ? `${opts.code} — your sign-in code` : `${opts.code} — код для входа`;

    const body = {
      sender: { email: senderEmail, name: senderName },
      to: [{ email: opts.to }],
      subject,
      htmlContent: renderHtml(opts.code, opts.locale),
      textContent: renderText(opts.code, opts.locale),
    };

    try {
      const res = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
          'accept': 'application/json',
          'api-key': apiKey,
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        console.error('[Brevo] send failed:', res.status, text.slice(0, 500));
        return false;
      }
      return true;
    } catch (err) {
      console.error('[Brevo] fetch threw:', err instanceof Error ? err.message : String(err));
      return false;
    }
  }
}

interface Strings {
  preheader: string;
  eyebrow: string;
  greeting: string;
  intro: string;
  codeLabel: string;
  ttl: string;
  ignore: string;
  security: string;
  footerTagline: string;
  footerCopyright: string;
  footerAuto: string;
}

function strings(locale: 'ru' | 'en'): Strings {
  if (locale === 'en') {
    return {
      preheader: 'Your sign-in code expires in 10 minutes.',
      eyebrow: 'Sign in',
      greeting: 'Your sign-in code',
      intro: 'Enter the code below on the sign-in screen to access BRATAN MUSIC.',
      codeLabel: 'One-time code',
      ttl: 'Valid for 10 minutes',
      ignore: 'Did not ask for this code? You can safely ignore this email — your account stays secure.',
      security: 'For your security, never share this code with anyone. BRATAN MUSIC will never ask for it.',
      footerTagline: 'Streaming without compromise',
      footerCopyright: '© BRATAN MUSIC. All rights reserved.',
      footerAuto: 'This is an automated message, please do not reply.',
    };
  }
  return {
    preheader: 'Код для входа действует 10 минут.',
    eyebrow: 'Вход',
    greeting: 'Ваш код для входа',
    intro: 'Введите код ниже на экране входа, чтобы открыть BRATAN MUSIC.',
    codeLabel: 'Одноразовый код',
    ttl: 'Действует 10 минут',
    ignore: 'Не запрашивали код? Просто проигнорируйте это письмо — аккаунт в безопасности.',
    security: 'В целях безопасности не передавайте этот код никому. BRATAN MUSIC никогда не запрашивает его.',
    footerTagline: 'Стриминг без компромиссов',
    footerCopyright: '© BRATAN MUSIC. Все права защищены.',
    footerAuto: 'Это автоматическое письмо, пожалуйста, не отвечайте на него.',
  };
}

function renderText(code: string, locale: 'ru' | 'en'): string {
  const s = strings(locale);
  return [
    `BRATAN MUSIC — ${s.eyebrow}`,
    '',
    `${s.greeting}: ${code}`,
    s.ttl + '.',
    '',
    s.intro,
    '',
    s.security,
    s.ignore,
    '',
    '—',
    s.footerTagline,
    s.footerAuto,
  ].join('\n');
}

/**
 * Render the OTP email body.
 *
 * Constraints email clients impose:
 *   - No external CSS or stylesheets — every style attribute must be
 *     inline. Gmail strips `<style>` blocks in some viewers.
 *   - No CSS custom properties (`var(--color-accent)`); we duplicate
 *     the literal hex/rgba values from `_tokens.scss` here so the
 *     palette stays in sync with the in-app dark theme.
 *   - No flexbox / grid in Outlook 2007–2019 (uses Word's HTML
 *     engine). The layout is built with nested `<table>`s for max
 *     compatibility and centred via `align="center"`.
 *   - Hidden `preheader` div forces the inbox preview text to read as
 *     a one-line tagline instead of the inline `Code: 123456` we'd
 *     otherwise leak to anyone with the inbox visible.
 *
 * The split radial-gradient header mirrors the site's hero — a
 * subtle violet→pink wash anchored top-left, fading into the dark
 * surface. The OTP code itself sits inside a "card" with a soft
 * accent halo behind it (mimics the in-app cursor-follow halo
 * effect from FeatureTile).
 */
function renderHtml(code: string, locale: 'ru' | 'en'): string {
  const s = strings(locale);

  // Brand palette — kept in sync with `src/styles/_tokens.scss` (dark
  // theme) so emails render in the same world as the in-app dark UI.
  const accent = '#7E89E8';      // --color-accent (dark)
  const subAccent = '#f472b6';   // --color-sub-accent
  const bg = '#0a0a0c';          // page background
  const surface = '#111114';     // card background
  const surfaceElev = '#16161a'; // code-block fill
  const border = '#26262b';      // --color-border
  const fg = '#fafafa';          // foreground
  const fgMuted = '#bdbdc4';     // muted-foreground
  const fgFaint = '#7a7a82';     // faintest text (footer disclaimer)

  return `<!doctype html>
<html lang="${locale}"><head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="dark light">
  <meta name="supported-color-schemes" content="dark light">
  <title>${escapeHtml(s.greeting)}</title>
</head>
<body style="margin:0;padding:0;background:${bg};color:${fg};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Helvetica Neue',Arial,sans-serif;-webkit-font-smoothing:antialiased;">
  <!-- Hidden preheader: the one-liner that previews next to the
       subject line in inbox listings. Drives the user's
       "is-this-relevant?" decision before opening. -->
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${bg};opacity:0;">
    ${escapeHtml(s.preheader)}
  </div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${bg};">
    <tr>
      <td align="center" style="padding:48px 16px;">
        <!-- Outer card. 480px max-width matches the in-app
             AuthGuard card, so the email feels visually adjacent
             to the surface the user just left. -->
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;width:100%;background:${surface};border:1px solid ${border};border-radius:20px;overflow:hidden;">
          <!-- Hero band: dark surface, pink-violet wash, brandmark
               and eyebrow. Mimics the gradient that lives behind the
               hero on the marketing landing. -->
          <tr>
            <td style="padding:0;background:${surface};background-image:radial-gradient(110% 110% at 0% 0%, ${accent}26 0%, transparent 55%), radial-gradient(120% 100% at 100% 100%, ${subAccent}1f 0%, transparent 60%);">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="padding:36px 36px 8px 36px;">
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td style="padding-right:12px;vertical-align:middle;">
                          <!-- Pure-CSS brandmark — a stylised play
                               glyph in a rounded square. Inline
                               SVG renders crisp on retina; falls
                               back gracefully on Outlook. -->
                          <span style="display:inline-block;width:36px;height:36px;border-radius:10px;background:linear-gradient(135deg, ${accent} 0%, ${subAccent} 100%);text-align:center;line-height:36px;vertical-align:middle;">
                            <span style="display:inline-block;color:#0a0a0c;font-size:18px;font-weight:700;letter-spacing:0;">♪</span>
                          </span>
                        </td>
                        <td style="vertical-align:middle;">
                          <div style="font-size:15px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;color:${fg};">BRATAN MUSIC</div>
                          <div style="font-size:11px;letter-spacing:0.22em;text-transform:uppercase;color:${accent};margin-top:2px;">${escapeHtml(s.eyebrow)}</div>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Title + intro -->
          <tr>
            <td style="padding:24px 36px 0 36px;">
              <h1 style="margin:0;font-size:22px;line-height:1.3;font-weight:600;letter-spacing:-0.01em;color:${fg};">
                ${escapeHtml(s.greeting)}
              </h1>
              <p style="margin:12px 0 0 0;font-size:14px;line-height:1.55;color:${fgMuted};">
                ${escapeHtml(s.intro)}
              </p>
            </td>
          </tr>

          <!-- OTP code card. Centered, monospaced, tracked-out so the
               6 digits are easy to type on mobile. The gradient
               border + accent-soft fill matches the in-app
               featured-card visual rhythm. -->
          <tr>
            <td style="padding:28px 36px 0 36px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${surfaceElev};border:1px solid ${border};border-radius:16px;background-image:radial-gradient(120% 100% at 50% 0%, ${accent}1a 0%, transparent 70%);">
                <tr>
                  <td align="center" style="padding:22px 16px 22px 16px;">
                    <div style="font-size:11px;letter-spacing:0.22em;text-transform:uppercase;color:${fgMuted};margin-bottom:10px;">${escapeHtml(s.codeLabel)}</div>
                    <div style="font-family:'SF Mono','Menlo','Monaco','Consolas',monospace;font-size:36px;font-weight:700;letter-spacing:0.36em;color:${fg};line-height:1;">
                      ${escapeHtml(code)}
                    </div>
                    <div style="font-size:12px;color:${accent};margin-top:14px;letter-spacing:0.04em;">
                      ${escapeHtml(s.ttl)}
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Security + ignore notes. Two-tier copy: the security
               line is the actionable advice, the ignore line is the
               escape hatch for a recipient who didn't request the
               code. -->
          <tr>
            <td style="padding:24px 36px 4px 36px;">
              <p style="margin:0;font-size:13px;line-height:1.55;color:${fgMuted};">
                ${escapeHtml(s.security)}
              </p>
              <p style="margin:14px 0 0 0;font-size:13px;line-height:1.55;color:${fgFaint};">
                ${escapeHtml(s.ignore)}
              </p>
            </td>
          </tr>

          <!-- Hairline divider before the footer. Pure 1px row keeps
               Outlook from crushing the spacing. -->
          <tr><td style="padding:28px 36px 0 36px;"><div style="height:1px;background:${border};line-height:1px;font-size:1px;">&nbsp;</div></td></tr>

          <!-- Footer -->
          <tr>
            <td style="padding:18px 36px 32px 36px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="padding-right:10px;vertical-align:middle;">
                    <span style="display:inline-block;width:6px;height:6px;border-radius:6px;background:${accent};vertical-align:middle;"></span>
                  </td>
                  <td style="vertical-align:middle;">
                    <div style="font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:${accent};">BRATAN MUSIC</div>
                  </td>
                </tr>
              </table>
              <div style="margin-top:8px;font-size:13px;font-weight:500;color:${fg};letter-spacing:-0.005em;">
                ${escapeHtml(s.footerTagline)}
              </div>
              <div style="margin-top:14px;font-size:11px;line-height:1.6;color:${fgFaint};">
                ${escapeHtml(s.footerCopyright)}<br>
                ${escapeHtml(s.footerAuto)}
              </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body></html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
