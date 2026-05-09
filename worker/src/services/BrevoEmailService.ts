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

function renderText(code: string, locale: 'ru' | 'en'): string {
  if (locale === 'en') {
    return [
      `Your BRATAN MUSIC sign-in code: ${code}`,
      '',
      'Enter it on the login screen — the code expires in 10 minutes.',
      'If you did not request this, ignore this email.',
    ].join('\n');
  }
  return [
    `Ваш код для входа в BRATAN MUSIC: ${code}`,
    '',
    'Введите его на экране входа — код действует 10 минут.',
    'Если вы не запрашивали вход, просто проигнорируйте это письмо.',
  ].join('\n');
}

function renderHtml(code: string, locale: 'ru' | 'en'): string {
  const greeting = locale === 'en' ? 'Your BRATAN MUSIC sign-in code' : 'Ваш код для входа в BRATAN MUSIC';
  const hint = locale === 'en'
    ? 'Enter it on the login screen — the code expires in 10 minutes.'
    : 'Введите его на экране входа — код действует 10 минут.';
  const ignore = locale === 'en'
    ? 'If you did not request this, ignore this email.'
    : 'Если вы не запрашивали вход, просто проигнорируйте это письмо.';
  return `<!doctype html>
<html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#0b0b0d;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
  <div style="max-width:480px;margin:0 auto;padding:48px 24px;color:#fafafa;">
    <div style="font-size:13px;letter-spacing:0.22em;text-transform:uppercase;color:#9b9aa3;margin-bottom:28px;">BRATAN MUSIC</div>
    <div style="font-size:18px;font-weight:600;margin-bottom:24px;">${escapeHtml(greeting)}</div>
    <div style="font-size:34px;font-weight:700;letter-spacing:0.36em;padding:18px 24px;background:#161618;border:1px solid #26262b;border-radius:14px;display:inline-block;">${escapeHtml(code)}</div>
    <p style="font-size:14px;line-height:1.5;color:#bdbdc4;margin-top:28px;">${escapeHtml(hint)}</p>
    <p style="font-size:12px;line-height:1.5;color:#7a7a82;margin-top:24px;">${escapeHtml(ignore)}</p>
  </div>
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
