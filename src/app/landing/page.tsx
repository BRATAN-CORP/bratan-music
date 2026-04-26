import { Headphones, Library, Music, Search, Shield, Sparkles, Star, Zap } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAutoAuth } from '@/hooks/useAuth';
import { useAuthStore } from '@/store/auth';
import { TelegramLoginButton } from '@/components/features/TelegramLoginButton';
import { Button } from '@/components/ui/Button';
import { Card, CardContent } from '@/components/ui/Card';

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
    <div className="relative flex flex-col items-center overflow-hidden px-6 py-12 lg:py-20">
      <div className="pointer-events-none absolute -top-24 h-80 w-80 rounded-full bg-primary/20 blur-3xl" />
      <div className="animate-enter relative z-10 flex max-w-4xl flex-col items-center text-center">
        <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-border bg-card/80 px-4 py-2 text-sm font-semibold text-muted-foreground backdrop-blur-xl">
          <Sparkles size={16} className="text-primary" />
          Музыка, Tidal и Telegram в одном месте
        </div>
        <h1 className="hero-gradient-text text-5xl font-black tracking-tight sm:text-7xl">
          BRATAN MUSIC
        </h1>
        <p className="mt-5 max-w-2xl text-lg text-muted-foreground sm:text-xl">
          Современный стриминговый сервис с поиском по Tidal, HiFi-качеством и быстрым входом через Telegram.
        </p>
      </div>

      {user ? (
        <div className="animate-enter mt-10 flex flex-col items-center gap-4">
          <p className="text-lg text-muted-foreground">
            Привет, <span className="font-medium">{user.name ?? user.username ?? 'пользователь'}</span>!
          </p>
          <Link to="/search">
            <Button size="lg">
              <Search size={18} />
              Найти музыку
            </Button>
          </Link>
        </div>
      ) : (
        <div className="animate-enter mt-10">
          <TelegramLoginButton />
        </div>
      )}

      <div className="mt-14 grid w-full max-w-5xl grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {features.map(({ icon: Icon, title, desc }) => (
          <Card
            key={title}
            className="animate-enter border-transparent bg-card/70 transition-all duration-300 hover:-translate-y-1 hover:border-primary/30 hover:shadow-[var(--shadow-glow)]"
          >
            <CardContent className="flex items-start gap-4">
              <div className="rounded-2xl bg-primary/15 p-3 text-primary">
                <Icon size={24} />
              </div>
              <div className="text-left">
                <p className="font-bold">{title}</p>
                <p className="mt-1 text-sm text-muted-foreground">{desc}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="animate-enter mt-10 w-full max-w-5xl overflow-hidden border-primary/20 bg-card/70">
        <CardContent className="flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2 text-primary">
              <Zap size={18} />
              <span className="text-sm font-bold uppercase tracking-[0.2em]">Новый поиск</span>
            </div>
            <p className="mt-2 text-2xl font-black">Реальный Tidal user API</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Поиск, альбомы, артисты и потоковые ссылки работают через актуальные web endpoints Tidal.
            </p>
          </div>
          <Link to="/search">
            <Button variant="secondary">
              Проверить поиск
              <Search size={16} />
            </Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
