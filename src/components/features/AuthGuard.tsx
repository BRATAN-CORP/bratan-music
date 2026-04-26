import type { ReactNode } from 'react';
import { useAuthStore } from '@/store/auth';
import { TelegramLoginButton } from './TelegramLoginButton';
import { Card, CardContent } from '@/components/ui/Card';

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
          <Card className="animate-enter max-w-md border-primary/20 bg-card/80">
            <CardContent className="flex flex-col items-center gap-5 py-10 text-center">
              <h2 className="hero-gradient-text text-3xl font-black">Войдите для продолжения</h2>
              <p className="text-muted-foreground">
                Авторизуйтесь через Telegram для доступа к музыке, библиотеке и плееру.
              </p>
              <TelegramLoginButton />
            </CardContent>
          </Card>
        </div>
      )
    );
  }

  return <>{children}</>;
}
