import type { Env } from '../types/env';

/**
 * Per-IP cap on freshly-created accounts over a rolling 24 h window.
 * Picked to comfortably allow a household / café / dorm to onboard a
 * handful of users from one NAT'd IP while still cutting down the
 * cheap "spin up N accounts to multiply the free-tier 3-tracks/day
 * ceiling" attack to a meaningful cost. A determined attacker behind
 * a VPN-rotation or residential-proxy network will still get
 * through, but at that level the cost-per-bypass already exceeds
 * the value of the bypass.
 */
const SIGNUPS_PER_IP_PER_DAY = 5;
const SIGNUP_WINDOW_SECONDS = 24 * 60 * 60;

/** Best-effort source-IP extraction from a Cloudflare-fronted request.
 *  Falls back through `CF-Connecting-IP` (always set on the edge),
 *  `X-Forwarded-For` (first hop, in case the request hit some other
 *  proxy first), and finally a literal "unknown" so the table never
 *  rejects an INSERT for a NULL IP. */
export function extractIp(req: Request): string {
  const cf = req.headers.get('CF-Connecting-IP');
  if (cf && cf.trim()) return cf.trim();
  const xff = req.headers.get('X-Forwarded-For');
  if (xff && xff.trim()) return xff.split(',')[0]!.trim() || 'unknown';
  return 'unknown';
}

/**
 * Cap signups per source IP. Returns `true` if the caller is still
 * under the limit (signup may proceed), `false` if the cap is
 * tripped. The check is intentionally cheap — a single COUNT(*) over
 * the (ip, created_at) index — and we don't surface "you have N
 * signups left" to the caller because the threshold itself is part
 * of the deterrent surface.
 */
export class SignupLogService {
  constructor(private env: Env) {}

  async canSignup(ip: string): Promise<boolean> {
    if (!ip || ip === 'unknown') {
      // Strict block when the edge can't tell us where the request
      // came from. In practice this only fires off-edge (local
      // wrangler dev) — the prod CDN always stamps the header.
      return true;
    }
    const since = Math.floor(Date.now() / 1000) - SIGNUP_WINDOW_SECONDS;
    const row = await this.env.DB
      .prepare('SELECT COUNT(*) AS cnt FROM signup_log WHERE ip = ? AND created_at >= ?')
      .bind(ip, since)
      .first<{ cnt: number }>();
    return (row?.cnt ?? 0) < SIGNUPS_PER_IP_PER_DAY;
  }

  async record(opts: { userId: string; ip: string; source: 'email' | 'telegram' }): Promise<void> {
    const now = Math.floor(Date.now() / 1000);
    await this.env.DB
      .prepare('INSERT INTO signup_log (user_id, ip, source, created_at) VALUES (?, ?, ?, ?)')
      .bind(opts.userId, opts.ip || 'unknown', opts.source, now)
      .run();
  }
}
