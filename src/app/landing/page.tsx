import {
  ArrowUpRight, Headphones, Library, Search, Send, Shield, ShieldOff,
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
 * Landing hook leads with the anti-censorship angle: the "перезалив"
 * feature lets a user drop their own version of any track on top of the
 * catalog entry, which means tracks that have been edited / muted /
 * cropped on other streaming platforms can be played here as the
 * artist released them. That's a positioning angle no other streaming
 * surface owns, and it stops the marketing being a vendor pitch
 * ("Tidal через Telegram") and starts being a product pitch
 * ("стриминг, в котором решаешь ты").
 */

// 9 tiles → exactly 3×3 on lg, 2-col on sm, 1-col on mobile.
// No `col-span-2` overrides: those left empty cells in the grid when
// the math didn't tile (3 spans of 2 + 7 spans of 1 = 13 cells in a
// 3-col grid → ragged bottom-right corner). Equal-weight tiles read
// like a feature inventory rather than a marketing manifest, and the
// hero/sub above already carries the leading anti-censorship pitch.
const features = [
  {
    icon: Replace,
    title: 'Поверх цензуры — твоя версия',
    desc: 'Загружаешь оригинал — он подменяет вырезанный или приглушённый трек прямо в каталоге. Никто, кроме тебя, не видит подмены.',
  },
  {
    icon: Waves,
    title: 'Своя волна',
    desc: 'Накидаешь 5 артистов — и плеер не остановится. Лайки и скипы он запоминает, и поток постепенно становится твоим.',
  },
  {
    icon: Headphones,
    title: '24-bit lossless',
    desc: 'Когда в каталоге есть мастер — слышишь мастер. Никаких mp3 на 128 и значков «HD» поверх обычного потока.',
  },
  {
    icon: Bolt,
    title: 'Crossfade и gapless',
    desc: 'Альбомы играют без чёрной дыры между треками. Следующий подмешиваем сверху — щелчков и пауз нет.',
  },
  {
    icon: Sliders,
    title: '10-band EQ',
    desc: 'Свои пресеты под наушники, машину, кухню. Один раз настроил — едет за тобой между устройствами.',
  },
  {
    icon: Library,
    title: 'Своя библиотека',
    desc: 'Плейлисты, лайки, очередь, история — твои. Никаких «может тебе понравится» поверх твоей коллекции.',
  },
  {
    icon: Shield,
    title: 'Без алгоритма-надсмотрщика',
    desc: 'Никаких подсунутых рекомендаций и оплаченных треков. Слушаешь то, что выбрал, а не что хотят показать.',
  },
  {
    icon: Share2,
    title: 'Шер плейлиста ссылкой',
    desc: 'Кидаешь URL — собеседник открывает и слушает то же. Без логинов, без баннера «установите наше приложение».',
  },
  {
    icon: Search,
    title: 'Поиск 100M+ треков',
    desc: 'Альбомы, артисты и треки в одном поле. Не блокируется по региону и не урезается подпиской.',
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
            <ShieldOff size={12} className="text-[var(--color-accent)]" />
            Расцензуренный стриминг
          </motion.div>

          <motion.h1
            initial={reduce ? false : { opacity: 0, y: 24 }}
            animate={reduce ? undefined : { opacity: 1, y: 0 }}
            transition={{ duration: 0.9, delay: 0.05, ease: EASE }}
            className="max-w-4xl text-[clamp(2.4rem,6.5vw,5.6rem)] font-semibold leading-[0.98] tracking-tight"
          >
            Цензура <span className="font-serif italic text-muted-foreground">заканчивается</span>
            <br />
            <span className="shine-text">на твоём плеере.</span>
          </motion.h1>

          <motion.p
            initial={reduce ? false : { opacity: 0, y: 16 }}
            animate={reduce ? undefined : { opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.15, ease: EASE }}
            className="max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg"
          >
            Любой трек, вырезанный или приглушённый на других площадках, подменяется твоей версией. Слушаешь как задумано — без затёртых слов и сокращений. Лосслесс 24-bit, crossfade, плейлисты по ссылке — в одной вкладке.
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
            Девять инструментов, которые превращают «ещё один стриминг» в персональную стрим-студию, в которой решаешь ты.
          </p>
        </Reveal>

        <Stagger className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {features.map(({ icon: Icon, title, desc }) => (
            <motion.div key={title} variants={staggerItem}>
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
