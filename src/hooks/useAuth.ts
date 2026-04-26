import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuthStore } from '@/store/auth';
import { api } from '@/lib/api';

interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: {
    id: string;
    username: string | null;
    name: string | null;
    isAdmin: boolean;
  };
}

interface NonceResponse {
  status: 'pending' | 'confirmed';
  accessToken?: string;
  refreshToken?: string;
  user?: {
    id: string;
    username: string | null;
    name: string | null;
    isAdmin: boolean;
  };
}

interface TelegramWebApp {
  initData?: string;
  ready?: () => void;
  expand?: () => void;
}

export function getTelegramWebApp(): TelegramWebApp | undefined {
  return (window as unknown as { Telegram?: { WebApp?: TelegramWebApp } }).Telegram?.WebApp;
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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loginWithInitData = useCallback(async (initData: string) => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.post<AuthResponse>('/auth/telegram', { initData });
      setAuth({ user: data.user, accessToken: data.accessToken, refreshToken: data.refreshToken });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка авторизации');
    } finally {
      setLoading(false);
    }
  }, [setAuth]);

  const loginWithDeeplink = useCallback((botUsername: string) => {
    const nonce = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
    const url = `https://t.me/${botUsername}?start=auth_${nonce}`;
    window.open(url, '_blank');
    return nonce;
  }, []);

  const pollNonce = useCallback(async (nonce: string, signal?: AbortSignal): Promise<boolean> => {
    const maxAttempts = 60;
    for (let i = 0; i < maxAttempts; i++) {
      if (signal?.aborted) return false;
      try {
        const data = await api.get<NonceResponse>(`/auth/nonce/${nonce}`);
        if (data.status === 'confirmed' && data.accessToken && data.refreshToken && data.user) {
          setAuth({ user: data.user, accessToken: data.accessToken, refreshToken: data.refreshToken });
          return true;
        }
      } catch {
        // ignore, retry
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
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
    logout,
  };
}

export function useAutoAuth() {
  const { loginWithInitData, isAuthenticated, pollNonce } = useAuth();
  const attempted = useRef(false);

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
