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
        <div className="flex min-h-[60dvh] items-center justify-center p-6">
          <div className="max-w-md rounded-[var(--radius-md)] border border-border bg-card px-8 py-10">
            <div className="flex flex-col items-start gap-4">
              <span className="text-xs font-medium uppercase tracking-[0.25em] text-muted-foreground">Доступ</span>
              <h2 className="text-2xl font-semibold tracking-tight">Войдите для продолжения</h2>
              <p className="text-sm leading-relaxed text-muted-foreground">
                Авторизуйтесь через Telegram, чтобы получить доступ к поиску, библиотеке и плееру.
              </p>
              <div className="pt-2">
                <TelegramLoginButton />
              </div>
            </div>
          </div>
        </div>
      )
    );
  }

  return <>{children}</>;
}
