import { LogOut, Crown, Shield } from 'lucide-react';
import { AuthGuard } from '@/components/features/AuthGuard';
import { useAuthStore } from '@/store/auth';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { UserLimits } from '@/types';
import { Button } from '@/components/ui/Button';
import { Card, CardContent } from '@/components/ui/Card';

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
      <div className="mx-auto flex max-w-md flex-col gap-6 p-4 sm:p-6 lg:p-8">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.24em] text-primary">Аккаунт</p>
          <h1 className="hero-gradient-text text-4xl font-black">Профиль</h1>
        </div>

        <Card className="animate-enter bg-card/70">
          <CardContent className="flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary text-2xl font-black text-primary-foreground shadow-[var(--shadow-glow)]">
              {(user?.name ?? user?.username ?? '?')[0]?.toUpperCase()}
            </div>
            <div>
              <p className="font-semibold">{user?.name ?? user?.username ?? 'Пользователь'}</p>
              {user?.username && (
                <p className="text-sm text-muted-foreground">@{user.username}</p>
              )}
            </div>
          </div>

          {profile?.isAdmin && (
            <div className="flex items-center gap-2 text-sm font-semibold text-primary">
              <Shield size={16} /> Администратор
            </div>
          )}
          </CardContent>
        </Card>

        <Card className="animate-enter bg-card/70">
          <CardContent className="flex flex-col gap-2">
          <h2 className="flex items-center gap-2 font-semibold">
            <Crown size={16} className="text-primary" />
            Подписка
          </h2>
          {profile?.subscription ? (
            <>
              <p className="text-sm font-semibold text-primary">Активна</p>
              <p className="text-xs text-muted-foreground">
                До {new Date(profile.subscription.expiresAt * 1000).toLocaleDateString('ru-RU')}
              </p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              Не активна. 3 трека в день бесплатно.
            </p>
          )}
          </CardContent>
        </Card>

        {limits && (
          <Card className="animate-enter bg-card/70">
            <CardContent className="flex flex-col gap-2">
            <h2 className="font-semibold">Лимиты</h2>
            {limits.daily.unlimited ? (
              <p className="text-sm font-semibold text-primary">Безлимитный доступ</p>
            ) : (
              <p className="text-sm text-muted-foreground">
                Использовано: {limits.daily.used} / {limits.daily.limit}
              </p>
            )}
            </CardContent>
          </Card>
        )}

        <Button onClick={logout} variant="danger" className="w-full">
          <LogOut size={16} />
          Выйти
        </Button>
      </div>
    </AuthGuard>
  );
}
