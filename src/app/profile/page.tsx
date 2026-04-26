import { LogOut, Crown, Shield } from 'lucide-react';
import { AuthGuard } from '@/components/features/AuthGuard';
import { useAuthStore } from '@/store/auth';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { UserLimits } from '@/types';

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
      <div className="p-6 max-w-md mx-auto flex flex-col gap-6">
        <h1 className="text-2xl font-bold">Профиль</h1>

        <div
          className="p-4 rounded-xl flex flex-col gap-3"
          style={{ backgroundColor: 'var(--color-surface-raised)' }}
        >
          <div className="flex items-center gap-3">
            <div
              className="w-14 h-14 rounded-full flex items-center justify-center text-xl font-bold"
              style={{ backgroundColor: 'var(--color-accent)', color: 'var(--color-text-on-accent)' }}
            >
              {(user?.name ?? user?.username ?? '?')[0]?.toUpperCase()}
            </div>
            <div>
              <p className="font-medium">{user?.name ?? user?.username ?? 'Пользователь'}</p>
              {user?.username && (
                <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>@{user.username}</p>
              )}
            </div>
          </div>

          {profile?.isAdmin && (
            <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--color-accent)' }}>
              <Shield size={16} /> Администратор
            </div>
          )}
        </div>

        <div
          className="p-4 rounded-xl flex flex-col gap-2"
          style={{ backgroundColor: 'var(--color-surface-raised)' }}
        >
          <h2 className="font-medium flex items-center gap-2">
            <Crown size={16} style={{ color: 'var(--color-accent)' }} />
            Подписка
          </h2>
          {profile?.subscription ? (
            <>
              <p className="text-sm" style={{ color: 'var(--color-accent)' }}>Активна</p>
              <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                До {new Date(profile.subscription.expiresAt * 1000).toLocaleDateString('ru-RU')}
              </p>
            </>
          ) : (
            <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
              Не активна. 3 трека в день бесплатно.
            </p>
          )}
        </div>

        {limits && (
          <div
            className="p-4 rounded-xl flex flex-col gap-2"
            style={{ backgroundColor: 'var(--color-surface-raised)' }}
          >
            <h2 className="font-medium">Лимиты</h2>
            {limits.daily.unlimited ? (
              <p className="text-sm" style={{ color: 'var(--color-accent)' }}>Безлимитный доступ</p>
            ) : (
              <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
                Использовано: {limits.daily.used} / {limits.daily.limit}
              </p>
            )}
          </div>
        )}

        <button
          onClick={logout}
          className="flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-medium"
          style={{ backgroundColor: 'var(--color-danger-muted)', color: 'var(--color-danger)' }}
        >
          <LogOut size={16} />
          Выйти
        </button>
      </div>
    </AuthGuard>
  );
}
