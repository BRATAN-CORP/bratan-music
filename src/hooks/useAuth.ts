import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuthStore } from '@/store/auth';
import { api } from '@/lib/api';
import { useT } from '@/i18n';

interface AuthUser {
  id: string;
  username: string | null;
  name: string | null;
  /** Returned by /auth/email/verify; absent on the Telegram path. */
  email?: string | null;
  isAdmin: boolean;
  tourCompletedAt: number | null;
}

interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: AuthUser;
}

interface NonceResponse {
  status: 'pending' | 'confirmed';
  accessToken?: string;
  refreshToken?: string;
  user?: AuthUser;
}

interface TelegramWebApp {
  initData?: string;
  ready?: () => void;
  expand?: () => void;
  enableClosingConfirmation?: () => void;
  isExpanded?: boolean;
  colorScheme?: 'light' | 'dark';
  themeParams?: { bg_color?: string };
}

export function getTelegramWebApp(): TelegramWebApp | undefined {
  return (window as unknown as { Telegram?: { WebApp?: TelegramWebApp } }).Telegram?.WebApp;
}

export function isTelegramWebApp(): boolean {
  const tg = getTelegramWebApp();
  return Boolean(tg && tg.initData);
}

function consumeQueryParam(name: string): string | null {
  const url = new URL(window.location.href);
  const value = url.searchParams.get(name);
  if (!value) return null;
  url.searchParams.delete(name);
  window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`);
  return value;
}

export function useAuth() {
  const { user, accessToken, setAuth, logout, isAuthenticated } = useAuthStore();
  const t = useT();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loginWithInitData = useCallback(async (initData: string) => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.post<AuthResponse>('/auth/telegram', { initData });
      setAuth({ user: data.user, accessToken: data.accessToken, refreshToken: data.refreshToken });
    } catch (err) {
      setError(err instanceof Error ? err.message : t('auth.error'));
    } finally {
      setLoading(false);
    }
  }, [setAuth, t]);

  const loginWithDeeplink = useCallback((botUsername: string) => {
    const nonce = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
    const url = `https://t.me/${botUsername}?start=auth_${nonce}`;
    window.open(url, '_blank');
    return nonce;
  }, []);

  /**
   * Email-OTP step 1 — request a 6-digit code to the address. Mirrors
   * the server contract in `worker/src/routes/auth.ts`: throws on
   * 4xx/5xx (with the server's `error` message), resolves on 200.
   */
  const requestEmailCode = useCallback(async (email: string) => {
    setError(null);
    await api.post<{ ok: true }>('/auth/email/request', { email });
  }, []);

  /**
   * Email-OTP step 2 — verify code and finalise login. Same JWT shape
   * as Telegram → reuses `setAuth` so the rest of the app sees a
   * standard authenticated session. Throws on bad code so the form
   * can surface the error inline.
   */
  const verifyEmailCode = useCallback(async (email: string, code: string) => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.post<AuthResponse>('/auth/email/verify', { email, code });
      setAuth({ user: data.user, accessToken: data.accessToken, refreshToken: data.refreshToken });
      return data;
    } finally {
      setLoading(false);
    }
  }, [setAuth]);

  const pollNonce = useCallback(async (nonce: string, signal?: AbortSignal): Promise<boolean> => {
    // Total budget: 5 min. Plain client-side polling — server-side
    // long-poll was removed because it held connections open and
    // exhausted Cloudflare KV daily write quota.
    const deadline = Date.now() + 5 * 60 * 1000;
    let consecutiveErrors = 0;
    while (Date.now() < deadline) {
      if (signal?.aborted) return false;
      try {
        const data = await api.get<NonceResponse>(`/auth/nonce/${nonce}`);
        if (data.status === 'confirmed' && data.accessToken && data.refreshToken && data.user) {
          setAuth({ user: data.user, accessToken: data.accessToken, refreshToken: data.refreshToken });
          return true;
        }
        consecutiveErrors = 0;
      } catch {
        consecutiveErrors++;
      }
      const gap = consecutiveErrors > 2 ? 3000 : 1000;
      await new Promise((resolve) => setTimeout(resolve, gap));
    }
    return false;
  }, [setAuth]);

  return {
    user,
    accessToken,
    loading,
    error,
    isAuthenticated: isAuthenticated(),
    loginWithInitData,
    loginWithDeeplink,
    pollNonce,
    requestEmailCode,
    verifyEmailCode,
    logout,
  };
}

export function useAutoAuth() {
  const { loginWithInitData, isAuthenticated, pollNonce } = useAuth();
  const attempted = useRef(false);

  useEffect(() => {
    const tg = getTelegramWebApp();
    if (tg) {
      try { tg.ready?.(); } catch { /* ignore */ }
      try { if (!tg.isExpanded) tg.expand?.(); } catch { /* ignore */ }
    }
  }, []);

  useEffect(() => {
    if (attempted.current || isAuthenticated) return;
    attempted.current = true;

    const initData = getTelegramWebApp()?.initData;
    if (initData) {
      loginWithInitData(initData);
      return;
    }

    const nonce = consumeQueryParam('auth_nonce');
    if (nonce) {
      void pollNonce(nonce);
    }
  }, [loginWithInitData, isAuthenticated, pollNonce]);
}
