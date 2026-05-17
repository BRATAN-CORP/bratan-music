import type { Env } from '../../types/env';

/**
 * Per-account "Explicit Content" filter is the Tidal feature that, when
 * enabled, transparently swaps explicit search hits for clean variants
 * and serves censored lyrics for tracks that have an Edited Lyrics
 * version. Pool accounts ship with the filter ON by default in some
 * regions (US/UK in particular), which surfaced as the user-visible
 * symptom "Drake/21 Savage звучат с цензурой и lyrics порезаны, хотя в
 * самом тайдале с того же аккаунта — без цензуры".
 *
 * Tidal's UI toggle is undocumented at the API level; this module
 * collects every variant we've seen across reverse-engineering forks
 * (python-tidal, tidal-dl-ng, tidalapi-rs, leaked Tidal Web client
 * dumps) and tries them sequentially. On the first 2xx it short-circuits
 * and writes a long-lived KV memo so subsequent worker requests don't
 * burn an upstream call. Every request is wrapped in try/catch — a
 * dead endpoint or 4xx never breaks the auth flow.
 *
 * Strict rules:
 *   - Best-effort: never throw out of `ensureExplicitAllowed`, never
 *     block the auth flow. The user can still listen to clean audio if
 *     this fails — just falls back to the legacy behaviour.
 *   - KV-memoised per Tidal user id (the account is what carries the
 *     setting, not the worker user). 30-day TTL is well under the
 *     practical staleness window — even if upstream rotates the setting
 *     on its end we'd reset it on the next cache miss.
 *   - Logged at warn level so the operator can see in `wrangler tail`
 *     whether any endpoint variant worked for a given account.
 */

const KV_KEY_PREFIX = 'tidal-explicit-allowed:';
const KV_TTL_S = 30 * 24 * 60 * 60; // 30 days
// Hard-cap the per-attempt timeout so a hung upstream can't stall the
// caller. Tidal's settings endpoints usually answer in <200ms; 4s is a
// safe ceiling that still finishes inside a CF Worker's CPU budget on
// the auth-refresh path.
const REQUEST_TIMEOUT_MS = 4000;

const COMMON_HEADERS = (clientVersion: string) => ({
  Accept: 'application/json',
  'User-Agent': 'TIDAL/2026.4.23 CFNetwork/1494.0.7 Darwin/23.4.0',
  'x-tidal-client-version': clientVersion,
});

async function timedFetch(url: string, init: RequestInit, timeoutMs: number): Promise<Response | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

interface AttemptResult {
  ok: boolean;
  status: number | null;
  endpoint: string;
}

/**
 * Each attempt represents one (endpoint × method × payload) combination
 * Tidal has historically accepted for the "allow explicit content"
 * mutation. The first attempt that returns 2xx wins.
 */
async function attemptAllowExplicit(
  accessToken: string,
  userId: number,
  countryCode: string,
  clientId: string | undefined,
  clientVersion: string,
): Promise<AttemptResult[]> {
  const auth = `Bearer ${accessToken}`;
  const baseHeaders = COMMON_HEADERS(clientVersion);
  const formHeaders = {
    ...baseHeaders,
    Authorization: auth,
    'Content-Type': 'application/x-www-form-urlencoded',
  };
  const jsonHeaders = {
    ...baseHeaders,
    Authorization: auth,
    'Content-Type': 'application/json',
  };

  // The mobile / TV OAuth clients each get registered with their own
  // clientSettings bucket. We default to the clientId associated with
  // the refresh token; when that's missing (legacy session) we still
  // try `com.aspiro.tidal` which is the canonical web-app bucket.
  const settingsBuckets = [clientId, 'com.aspiro.tidal', 'android.aspiro.tidal']
    .filter((b, i, arr): b is string => Boolean(b) && arr.indexOf(b) === i);

  const attempts: { endpoint: string; init: RequestInit }[] = [];

  // 1. v2 user-profile playback settings (newer Tidal Web client).
  attempts.push({
    endpoint: `PUT /v2/profiles/${userId}/playbackSettings`,
    init: {
      method: 'PUT',
      headers: jsonHeaders,
      body: JSON.stringify({ explicitContentAllowed: true }),
    },
  });

  // 2. v1 client-settings items PATCH (per-client bucket).
  for (const bucket of settingsBuckets) {
    attempts.push({
      endpoint: `PATCH /v1/users/${userId}/clientSettings/${bucket}`,
      init: {
        method: 'PATCH',
        headers: jsonHeaders,
        body: JSON.stringify({
          items: [
            { name: 'PLAYBACK_EXPLICIT_CONTENT', value: 'true' },
            { name: 'EXPLICIT_CONTENT_ENABLED', value: 'true' },
          ],
        }),
      },
    });
  }

  // 3. v1 form-encoded subscription endpoint (legacy mobile client).
  attempts.push({
    endpoint: `POST /v1/users/${userId}/subscription/explicit-content`,
    init: {
      method: 'POST',
      headers: formHeaders,
      body: new URLSearchParams({
        enabled: 'true',
        countryCode,
      }).toString(),
    },
  });

  // 4. v2 me-scoped explicit-content toggle.
  attempts.push({
    endpoint: 'PUT /v2/users/me/explicit-content',
    init: {
      method: 'PUT',
      headers: jsonHeaders,
      body: JSON.stringify({ allowed: true }),
    },
  });

  const results: AttemptResult[] = [];
  for (const { endpoint, init } of attempts) {
    const [method, path] = endpoint.split(' ');
    const url = `https://api.tidal.com${path}`;
    const res = await timedFetch(url, { ...init, method }, REQUEST_TIMEOUT_MS);
    if (!res) {
      results.push({ ok: false, status: null, endpoint });
      continue;
    }
    results.push({ ok: res.ok, status: res.status, endpoint });
    if (res.ok) break;
  }
  return results;
}

/**
 * Idempotent. Call this whenever a Tidal session is freshly minted /
 * refreshed. Returns true if the filter is known-disabled (either via
 * cache hit or a successful upstream toggle), false otherwise. The
 * caller should NOT branch on the return value — it's purely
 * informational.
 */
export async function ensureExplicitAllowed(
  env: Env,
  params: {
    accessToken: string;
    userId: number;
    countryCode: string;
    clientId?: string;
    clientVersion: string;
  },
): Promise<boolean> {
  if (!params.userId) return false;
  const cacheKey = `${KV_KEY_PREFIX}${params.userId}`;

  try {
    const cached = await env.SESSIONS.get(cacheKey).catch(() => null);
    if (cached === '1') return true;
  } catch {
    // KV transient failure — fall through to the real attempt.
  }

  const results = await attemptAllowExplicit(
    params.accessToken,
    params.userId,
    params.countryCode,
    params.clientId,
    params.clientVersion,
  ).catch((): AttemptResult[] => []);

  const winner = results.find((r) => r.ok);
  if (winner) {
    // Persist the success so future requests skip the round trip.
    await env.SESSIONS
      .put(cacheKey, '1', { expirationTtl: KV_TTL_S })
      .catch(() => null);
    console.log(
      `[tidal:explicit] uid=${params.userId} OK via ${winner.endpoint} (${winner.status})`,
    );
    return true;
  }

  // Every variant failed — log enough breadcrumb for the operator to
  // spot if Tidal rotates the endpoint shape again. Failures don't
  // get cached: next refresh tries again, since the right fix might
  // already be live by then.
  const summary = results
    .map((r) => `${r.endpoint}=${r.status ?? 'timeout'}`)
    .join(', ');
  console.warn(
    `[tidal:explicit] uid=${params.userId} every variant failed: ${summary || 'no attempts'}`,
  );
  return false;
}
