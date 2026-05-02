import { useAuthStore } from '@/store/auth';
import { t } from '@/i18n/runtime';

const API_BASE = import.meta.env.VITE_API_URL ?? 'https://bratan-music-api.bratan-corp.workers.dev';

function parseErrorMessage(text: string): string {
  try {
    const data = JSON.parse(text) as unknown;
    if (typeof data === 'object' && data !== null && 'error' in data) {
      const error = (data as { error?: unknown }).error;
      if (typeof error === 'string') return error;
    }
  } catch {
    return text;
  }
  return text;
}

/**
 * Error subclass that preserves the HTTP status code from the failed
 * response. Callers that need to branch on specific statuses (e.g. 402
 * for the subscription paywall) can `instanceof ApiError` and read
 * `err.status`. Plain `catch (err: Error)` callers still see the
 * parsed message via `err.message`.
 */
export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

/**
 * In-flight refresh promise. When a 401 lands in two concurrent
 * requests we want them to share the same refresh attempt — otherwise
 * the second call would post the refresh token AFTER the first call
 * has already rotated it, the server would reject the now-stale
 * token, and we'd log the user out even though the first refresh
 * succeeded. Was the most common cause of "слетает авторизация с
 * аккаунта" reports: parallel preload / queue / library queries on
 * page load all expired together, the first refresh rotated the
 * token, the rest stampeded with the old one and tripped the logout
 * path.
 *
 * The promise resolves to `true` on success, `false` on a definitive
 * auth failure (server said the refresh token itself is invalid),
 * and rejects only on transient network errors so callers can decide
 * to bail without logging the user out.
 */
let inFlightRefresh: Promise<RefreshOutcome> | null = null;

type RefreshOutcome = 'ok' | 'rejected' | 'transient';

async function refreshOnce(): Promise<RefreshOutcome> {
  const refreshToken = useAuthStore.getState().refreshToken;
  if (!refreshToken) return 'rejected';
  try {
    const res = await fetch(`${API_BASE}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    if (res.ok) {
      const data = (await res.json()) as { accessToken: string; refreshToken: string };
      useAuthStore.getState().setTokens(data);
      return 'ok';
    }
    // 401/403 on the refresh endpoint itself means the refresh
    // token is no longer valid (logged out elsewhere, rotated, etc.)
    // — that's a definitive auth failure and the user has to sign
    // in again.
    if (res.status === 401 || res.status === 403) return 'rejected';
    // Anything else (5xx, 502, 504, …) is a transient server hiccup.
    // Don't log the user out on a temporary outage.
    return 'transient';
  } catch {
    // Network error (offline, DNS, CORS preflight blocked, etc.).
    // Treat as transient so we don't punish the user for a flaky
    // connection.
    return 'transient';
  }
}

async function getRefreshOutcome(): Promise<RefreshOutcome> {
  if (inFlightRefresh) return inFlightRefresh;
  inFlightRefresh = refreshOnce().finally(() => {
    inFlightRefresh = null;
  });
  return inFlightRefresh;
}

interface RequestOptions extends RequestInit {
  /** Internal: skip the auto-refresh flow on 401. Used to break
   *  recursion when retrying a request after a successful refresh. */
  _skipRefresh?: boolean;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const token = useAuthStore.getState().accessToken;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((options.headers as Record<string, string>) ?? {}),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });

  if (res.status === 401 && !options._skipRefresh) {
    const outcome = await getRefreshOutcome();
    if (outcome === 'ok') {
      // Retry once with the freshly-rotated access token. The
      // `_skipRefresh` flag prevents an infinite loop if the new
      // token also lands on a 401 (e.g. permissions-level 401, not
      // expiry).
      return request<T>(path, { ...options, _skipRefresh: true });
    }
    if (outcome === 'rejected') {
      // Refresh definitively failed — the user has to sign in
      // again. Only this branch logs out.
      useAuthStore.getState().logout();
      throw new ApiError(401, t('errors_more.reLoginRequired'));
    }
    // Transient: bubble the 401 to the caller WITHOUT logging out.
    // The next request after the network recovers can re-try the
    // refresh and succeed.
    throw new ApiError(401, t('errors_more.sessionRefreshFailed'));
  }

  if (!res.ok) throw new ApiError(res.status, parseErrorMessage(await res.text()));
  return res.json() as Promise<T>;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PUT', body: body ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PATCH', body: body ? JSON.stringify(body) : undefined }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};
