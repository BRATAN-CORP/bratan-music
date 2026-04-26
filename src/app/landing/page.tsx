import { useAutoAuth } from '@/hooks/useAuth';
import { useAuthStore } from '@/store/auth';
import { TelegramLoginButton } from '@/components/features/TelegramLoginButton';

export function LandingPage() {
  useAutoAuth();
  const user = useAuthStore((s) => s.user);

  return (
    <div className="flex flex-col items-center justify-center flex-1 p-8 text-center">
      <h1 className="text-4xl font-bold mb-4" style={{ color: 'var(--color-accent)' }}>
        BRATAN MUSIC
      </h1>
      <p className="text-lg mb-8" style={{ color: 'var(--color-text-muted)' }}>
        Музыкальный стриминговый сервис
      </p>

      {user ? (
        <p className="text-lg">
          Привет, <span className="font-medium">{user.name ?? user.username ?? 'пользователь'}</span>!
        </p>
      ) : (
        <TelegramLoginButton />
      )}
    </div>
  );
}
