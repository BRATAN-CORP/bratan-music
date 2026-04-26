import { LogOut, Crown, Shield } from 'lucide-react';
import { AuthGuard } from '@/components/features/AuthGuard';
import { useAuthStore } from '@/store/auth';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { UserLimits } from '@/types';
import { Button } from '@/components/ui/Button';

interface UserProfile {
  id: string;
  username: string | null;
  name: string | null;
  isAdmin: boolean;
  subscription: { status: string; expiresAt: number } | null;
}

export function ProfilePage() {
  const { user, logout } = useAuthStore();
  const { data: profile } = useQuery({
    queryKey: ['profile'],
    queryFn: () => api.get<UserProfile>('/user/me'),
    enabled: !!user,
  });
  const { data: limits } = useQuery({
    queryKey: ['limits'],
    queryFn: () => api.get<UserLimits>('/user/limits'),
    enabled: !!user,
  });

  return (
    <AuthGuard>
      <div className="mx-auto flex max-w-md flex-col gap-6 p-4 sm:p-6 lg:p-10">
        <div className="flex flex-col gap-1 border-b border-border pb-4">
          <span className="text-xs font-medium uppercase tracking-[0.25em] text-muted-foreground">Аккаунт</span>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Профиль</h1>
        </div>

        <section className="rounded-[var(--radius-md)] border border-border bg-card p-5">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-full border border-border bg-background text-base font-semibold">
              {(user?.name ?? user?.username ?? '?')[0]?.toUpperCase()}
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{user?.name ?? user?.username ?? 'Пользователь'}</p>
              {user?.username && <p className="truncate text-xs text-muted-foreground">@{user.username}</p>}
            </div>
          </div>
          {profile?.isAdmin && (
            <div className="mt-4 flex items-center gap-2 border-t border-border pt-4 text-xs font-medium text-foreground">
              <Shield size={14} /> Администратор
            </div>
          )}
        </section>

        <section className="rounded-[var(--radius-md)] border border-border bg-card p-5">
          <h2 className="flex items-center gap-2 text-sm font-medium">
            <Crown size={14} className="text-muted-foreground" />
            Подписка
          </h2>
          {profile?.subscription ? (
            <>
              <p className="mt-3 text-sm font-medium">Активна</p>
              <p className="mt-1 text-xs text-muted-foreground">
                До {new Date(profile.subscription.expiresAt * 1000).toLocaleDateString('ru-RU')}
              </p>
            </>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">Не активна. 3 трека в день бесплатно.</p>
          )}
        </section>

        {limits && (
          <section className="rounded-[var(--radius-md)] border border-border bg-card p-5">
            <h2 className="text-sm font-medium">Лимиты</h2>
            {limits.daily.unlimited ? (
              <p className="mt-3 text-sm font-medium">Безлимитный доступ</p>
            ) : (
              <p className="mt-3 text-sm text-muted-foreground">
                Использовано: {limits.daily.used} / {limits.daily.limit}
              </p>
            )}
          </section>
        )}

        <Button onClick={logout} variant="danger" className="w-full">
          <LogOut size={14} />
          Выйти
        </Button>
      </div>
    </AuthGuard>
  );
}
