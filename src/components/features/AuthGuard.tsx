import type { ReactNode } from 'react';
import { useAuthStore } from '@/store/auth';
import { Eyebrow } from '@/components/ui/SectionHeading';
import { TelegramLoginButton } from './TelegramLoginButton';
import { useT } from '@/i18n';

interface AuthGuardProps {
  children: ReactNode;
  fallback?: ReactNode;
}

export function AuthGuard({ children, fallback }: AuthGuardProps) {
  const t = useT();
  const isAuthenticated = useAuthStore((s) => s.accessToken !== null);

  if (!isAuthenticated) {
    return (
      fallback ?? (
        <div className="flex min-h-[60dvh] items-center justify-center p-6">
          <div className="max-w-md rounded-[var(--radius-md)] border border-border bg-card px-8 py-10">
            <div className="flex flex-col items-start gap-4">
              <Eyebrow>{t('authGuard.eyebrow')}</Eyebrow>
              <h2 className="text-2xl font-semibold tracking-tight">{t('authGuard.title')}</h2>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {t('authGuard.body')}
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
