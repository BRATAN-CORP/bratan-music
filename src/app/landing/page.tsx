import { Search, Library, Music, Headphones, Star, Shield } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAutoAuth } from '@/hooks/useAuth';
import { useAuthStore } from '@/store/auth';
import { TelegramLoginButton } from '@/components/features/TelegramLoginButton';

const features = [
  { icon: Search, title: 'Поиск', desc: 'Треки, альбомы и артисты' },
  { icon: Library, title: 'Библиотека', desc: 'Плейлисты и избранное' },
  { icon: Music, title: 'Перезалив', desc: 'Загружай свои версии' },
  { icon: Headphones, title: 'HiFi', desc: 'Качество без потерь' },
  { icon: Star, title: 'Подписка', desc: '99 Stars / месяц' },
  { icon: Shield, title: 'Безопасность', desc: 'Авторизация через Telegram' },
];

export function LandingPage() {
  useAutoAuth();
  const user = useAuthStore((s) => s.user);

  return (
    <div className="flex flex-col items-center px-6 py-12">
      <h1 className="text-4xl sm:text-5xl font-bold mb-3 text-center" style={{ color: 'var(--color-accent)' }}>
        BRATAN MUSIC
      </h1>
      <p className="text-lg mb-10 text-center" style={{ color: 'var(--color-text-muted)' }}>
        Музыкальный стриминговый сервис
      </p>

      {user ? (
        <div className="flex flex-col items-center gap-4 mb-12">
          <p className="text-lg">
            Привет, <span className="font-medium">{user.name ?? user.username ?? 'пользователь'}</span>!
          </p>
          <Link
            to="/search"
            className="flex items-center gap-2 px-6 py-3 rounded-full text-sm font-medium"
            style={{ backgroundColor: 'var(--color-accent)', color: 'var(--color-text-on-accent)' }}
          >
            <Search size={16} />
            Найти музыку
          </Link>
        </div>
      ) : (
        <div className="mb-12">
          <TelegramLoginButton />
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 w-full max-w-lg">
        {features.map(({ icon: Icon, title, desc }) => (
          <div
            key={title}
            className="flex flex-col items-center gap-2 p-4 rounded-xl text-center"
            style={{ backgroundColor: 'var(--color-surface-raised)' }}
          >
            <Icon size={24} style={{ color: 'var(--color-accent)' }} />
            <p className="text-sm font-medium">{title}</p>
            <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{desc}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
