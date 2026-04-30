import {
  ArrowUpRight, Headphones, Library, Search, Send, Shield, Sparkles,
  Sliders, Share2, Replace, Waves, Bolt,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { motion, useReducedMotion } from 'motion/react';
import { useAutoAuth } from '@/hooks/useAuth';
import { useAuthStore } from '@/store/auth';
import { TelegramLoginButton } from '@/components/features/TelegramLoginButton';
import { Button } from '@/components/ui/Button';
import { Aurora } from '@/components/ui/Aurora';
import { Reveal, Stagger } from '@/components/ui/Reveal';
import { AnimatedNumber } from '@/components/ui/AnimatedNumber';
import { TiltCard } from '@/components/ui/TiltCard';
import { EASE_SPRING as EASE, staggerItem } from '@/lib/motion';

/**
 * Landing copy is intentionally not framed as "Tidal через Telegram":
 *
 *   1. We want the product to stand on its own listening experience —
 *      lossless catalog + cold-start in seconds + a real personal wave —
 *      not on being a thin re-skin of someone else's app.
 *   2. The "Tidal" name is a backend implementation detail; pinning it
 *      to the marketing surface couples our positioning to a vendor.
 *
 * Hero hook is "Lossless без приложений": studio-grade stream, login
 * in one tap, no app store, no card forms.
 */

const features = [
  {
    icon: Waves,
    title: 'Моя волна за 60 секунд',
    desc: 'Назови 1–6 артистов — и поднимется бесконечный поток под твой вкус, который учится с каждой реакцией.',
    span: 'lg:col-span-2',
  },
  {
    icon: Headphones,
    title: '24-bit lossless',
    desc: 'HiFi и Master, когда есть в каталоге. Никаких пережатых mp3 и фейковых «high quality».',
  },
  {
    icon: Bolt,
    title: 'Crossfade и gapless',
    desc: 'Треки сшиваются без щелчка и тишины. Как в студии, не как в плеере.',
  },
  {
    icon: Sliders,
    title: '10-band параметрический EQ',
    desc: 'Свои пресеты, на любую акустику и наушники. Сохраняем за тобой между устройствами.',
    span: 'lg:col-span-2',
  },
  {
    icon: Library,
    title: 'Своя библиотека',
    desc: 'Плейлисты, лайки, история — твои. Не алгоритм решает, что ты услышишь завтра.',
  },
  {
    icon: Replace,
    title: 'Перезалив',
    desc: 'Своя версия трека поверх каталога — с лучшим мастером или редкой редакцией. Видишь только ты.',
  },
  {
    icon: Share2,
    title: 'Плейлисты по ссылке',
    desc: 'Делишься плейлистом одним URL, без логина — и собеседник слышит то же, что и ты.',
  },
  {
    icon: Search,
    title: 'Поиск без границ',
    desc: '100M+ треков, альбомов и артистов в одном поле. Без жанровых стен и платных регионов.',
    span: 'lg:col-span-2',
  },
  {
    icon: Shield,
    title: 'Без паролей и рекламы',
    desc: 'Вход через Telegram, оплата Stars. Никаких карт, e-mail, токенов или баннеров на фоне музыки.',
  },
];

const stats = [
  { value: 100, suffix: 'M+', label: 'треков в каталоге' },
  { value: 24, suffix: '-bit', label: 'lossless audio' },
  { value: 99, suffix: 'Stars', label: 'в месяц' },
];

export function LandingPage() {
  useAutoAuth();
  const user = useAuthStore((s) => s.user);
  const reduce = useReducedMotion();

  return (
    <div className="relative w-full">
      <section className="relative overflow-hidden pb-24 pt-20 sm:pt-28 lg:pb-32 lg:pt-36">
        <Aurora />
        <div className="grid-bg absolute inset-0 opacity-30" aria-hidden />

        <div className="relative mx-auto flex max-w-6xl flex-col items-start gap-8 px-4 sm:px-6 lg:px-10">
          <motion.div
            initial={reduce ? false : { opacity: 0, y: 12 }}
            animate={reduce ? undefined : { opacity: 1, y: 0 }}
            transition={{ duration: 0.7, ease: EASE }}
            className="inline-flex items-center gap-2 rounded-full border border-border bg-[var(--color-surface-elevated)] px-3 py-1.5 text-xs font-medium text-muted-foreground backdrop-blur"
          >
            <Sparkles size={12} className="text-[var(--color-accent)]" />
            Lossless · без приложений
          </motion.div>

          <motion.h1
            initial={reduce ? false : { opacity: 0, y: 24 }}
            animate={reduce ? undefined : { opacity: 1, y: 0 }}
            transition={{ duration: 0.9, delay: 0.05, ease: EASE }}
            className="max-w-4xl text-[clamp(2.4rem,6.5vw,5.6rem)] font-semibold leading-[0.98] tracking-tight"
          >
            Слушай <span className="font-serif italic text-muted-foreground">студийно</span>.
            <br />
            <span className="shine-text">Без приложений и логинов.</span>
          </motion.h1>

          <motion.p
            initial={reduce ? false : { opacity: 0, y: 16 }}
            animate={reduce ? undefined : { opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.15, ease: EASE }}
            className="max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg"
          >
            24-bit стрим, бесконечная личная волна, плейлисты по ссылке и crossfade без щелчков. Открывается в браузере, оплачивается Telegram&nbsp;Stars — без карт, e-mail и App Store.
          </motion.p>

          <motion.div
            initial={reduce ? false : { opacity: 0, y: 12 }}
            animate={reduce ? undefined : { opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.25, ease: EASE }}
            className="flex flex-wrap items-center gap-3 pt-2"
          >
            {user ? (
              <Link to="/search">
                <Button size="lg" className="gap-2">
                  <Search size={16} />
                  Открыть поиск
                  <ArrowUpRight size={16} className="transition-transform group-hover:translate-x-0.5" />
                </Button>
              </Link>
            ) : (
              <TelegramLoginButton />
            )}
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <Send size={12} />
              Вход одним тапом из Telegram
            </span>
          </motion.div>

          <Stagger className="grid w-full max-w-3xl grid-cols-3 gap-4 pt-12 sm:gap-8" delay={0.35}>
            {stats.map((stat) => (
              <motion.div key={stat.label} variants={staggerItem} className="flex flex-col gap-1">
                <div className="text-2xl font-semibold tracking-tight text-foreground sm:text-4xl">
                  <AnimatedNumber value={stat.value} />
                  <span className="text-muted-foreground">{stat.suffix}</span>
                </div>
                <p className="text-xs text-muted-foreground sm:text-sm">{stat.label}</p>
              </motion.div>
            ))}
          </Stagger>
        </div>
      </section>

      <section className="relative mx-auto max-w-6xl px-4 pb-20 pt-12 sm:px-6 sm:pt-0 lg:px-10">
        <Reveal className="mb-10 flex items-end justify-between gap-6 border-b border-border pb-4">
          <div className="flex flex-col gap-2">
            <span className="text-xs font-medium uppercase tracking-[0.25em] text-muted-foreground">
              Возможности
            </span>
            <h2 className="text-2xl font-semibold tracking-tight sm:text-4xl">Что внутри.</h2>
          </div>
          <p className="hidden max-w-md text-sm text-muted-foreground sm:block">
            Девять инструментов, которые превращают «ещё один плеер» в персональную студию прослушивания.
          </p>
        </Reveal>

        <Stagger className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {features.map(({ icon: Icon, title, desc, span }) => (
            <motion.div key={title} variants={staggerItem} className={span ?? ''}>
              <TiltCard intensity={8} className="h-full rounded-[var(--radius-lg)]">
                <div className="group relative flex h-full flex-col gap-3 overflow-hidden rounded-[var(--radius-lg)] border border-border bg-card p-6 transition-colors hover:border-[var(--color-border-strong)]">
                  <div
                    className="pointer-events-none absolute -right-24 -top-24 h-48 w-48 rounded-full opacity-0 blur-3xl transition-opacity duration-500 group-hover:opacity-100"
                    style={{
                      background:
                        'radial-gradient(circle, var(--color-accent-glow) 0%, transparent 70%)',
                    }}
                    aria-hidden
                  />
                  <div
                    className="relative flex h-9 w-9 items-center justify-center rounded-[var(--radius-sm)] border border-border bg-background text-foreground"
                    style={{ transform: 'translateZ(40px)' }}
                  >
                    <Icon size={16} />
                  </div>
                  <p className="relative text-base font-semibold tracking-tight" style={{ transform: 'translateZ(30px)' }}>
                    {title}
                  </p>
                  <p className="relative text-sm leading-relaxed text-muted-foreground" style={{ transform: 'translateZ(20px)' }}>
                    {desc}
                  </p>
                </div>
              </TiltCard>
            </motion.div>
          ))}
        </Stagger>
      </section>

      <section className="relative mx-auto max-w-6xl px-4 pb-24 sm:px-6 lg:px-10">
        <Reveal className="relative overflow-hidden rounded-[var(--radius-xl)] border border-border bg-card p-8 sm:p-12">
          <Aurora variant="subtle" />
          <div className="relative flex flex-col items-start gap-6">
            <span className="text-xs font-medium uppercase tracking-[0.25em] text-muted-foreground">
              Готов?
            </span>
            <h3 className="max-w-3xl text-3xl font-semibold leading-tight tracking-tight sm:text-5xl">
              Начни слушать <span className="font-serif italic text-muted-foreground">через минуту</span>.
            </h3>
            <p className="max-w-2xl text-sm text-muted-foreground sm:text-base">
              Открой Telegram, нажми вход, запускай первый трек. Без карт, без e-mail, без подтверждений.
            </p>
            <div className="flex flex-wrap items-center gap-3 pt-2">
              {user ? (
                <Link to="/search">
                  <Button size="lg" className="gap-2">
                    <Search size={16} /> Найти музыку
                  </Button>
                </Link>
              ) : (
                <TelegramLoginButton />
              )}
            </div>
          </div>
        </Reveal>
      </section>
    </div>
  );
}
