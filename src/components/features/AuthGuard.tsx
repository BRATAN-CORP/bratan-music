import type { ReactNode } from 'react';
import { useAuthStore } from '@/store/auth';
import { TelegramLoginButton } from './TelegramLoginButton';

interface AuthGuardProps {
  children: ReactNode;
  fallback?: ReactNode;
}

export function AuthGuard({ children, fallback }: AuthGuardProps) {
  const isAuthenticated = useAuthStore((s) => s.accessToken !== null);

  if (!isAuthenticated) {
    return (
      fallback ?? (
        <div className="flex flex-col items-center justify-center flex-1 p-8 text-center gap-6">
          <h2 className="text-xl font-bold">Войдите для продолжения</h2>
          <p style={{ color: 'var(--color-text-muted)' }}>
            Авторизуйтесь через Telegram для доступа к музыке
          </p>
          <TelegramLoginButton />
        </div>
      )
    );
  }

  return <>{children}</>;
}
