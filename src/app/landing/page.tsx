import { Headphones, Library, Music, Search, Shield, Star } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAutoAuth } from '@/hooks/useAuth';
import { useAuthStore } from '@/store/auth';
import { TelegramLoginButton } from '@/components/features/TelegramLoginButton';
import { Button } from '@/components/ui/Button';

const features = [
  { icon: Search, title: 'Поиск', desc: 'Треки, альбомы и артисты в Tidal.' },
  { icon: Library, title: 'Библиотека', desc: 'Плейлисты и избранное.' },
  { icon: Music, title: 'Перезалив', desc: 'Свои версии треков на стороне сервиса.' },
  { icon: Headphones, title: 'HiFi', desc: 'Качество без потерь, когда доступно.' },
  { icon: Star, title: 'Подписка', desc: '99 Stars в месяц через Telegram.' },
  { icon: Shield, title: 'Безопасность', desc: 'Вход через Telegram, без паролей.' },
];

export function LandingPage() {
  useAutoAuth();
  const user = useAuthStore((s) => s.user);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col px-6 py-16 lg:py-24">
      <section className="flex flex-col gap-6 border-b border-border pb-16">
        <span className="text-xs font-medium uppercase tracking-[0.25em] text-muted-foreground">
          Музыкальный сервис
        </span>
        <h1 className="max-w-3xl text-4xl font-semibold leading-[1.05] tracking-tight sm:text-6xl">
          BRATAN&nbsp;MUSIC.
          <br />
          <span className="text-muted-foreground">Tidal, прямо из Telegram.</span>
        </h1>
        <p className="max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg">
          Поиск, плейлисты, лайки и&nbsp;стриминг через каталог Tidal. Вход через Telegram, оплата через Stars,
          без приложения и&nbsp;без отдельного аккаунта.
        </p>

        <div className="flex flex-wrap items-center gap-3 pt-2">
          {user ? (
            <Link to="/search">
              <Button size="lg">
                <Search size={16} />
                Найти музыку
              </Button>
            </Link>
          ) : (
            <TelegramLoginButton />
          )}
          <Link to="/search">
            <Button size="lg" variant="outline">
              Открыть поиск
            </Button>
          </Link>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-px bg-border sm:grid-cols-2 lg:grid-cols-3">
        {features.map(({ icon: Icon, title, desc }) => (
          <div key={title} className="flex flex-col gap-3 bg-background p-6">
            <Icon size={18} className="text-foreground" />
            <p className="text-base font-semibold">{title}</p>
            <p className="text-sm leading-relaxed text-muted-foreground">{desc}</p>
          </div>
        ))}
      </section>

      <section className="mt-16 flex flex-col gap-3 border-t border-border pt-10">
        <span className="text-xs font-medium uppercase tracking-[0.25em] text-muted-foreground">
          Что нового
        </span>
        <p className="text-2xl font-semibold tracking-tight sm:text-3xl">
          Реальный Tidal user API.
        </p>
        <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">
          Поиск, альбомы, артисты и потоковые ссылки идут через актуальные эндпоинты Tidal с авто-обновлением сессии.
        </p>
        <div className="pt-1">
          <Link to="/search">
            <Button variant="outline">Проверить поиск</Button>
          </Link>
        </div>
      </section>
    </div>
  );
}
