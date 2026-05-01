import {
  ArrowUpRight, Headphones, Search, ShieldOff,
  Sliders, Share2, Replace, Bolt, Sparkles,
  Users, MicVocal, UploadCloud, Radio,
  type LucideIcon,
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
import { cn } from '@/lib/utils';

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

interface Feature {
  icon: LucideIcon;
  title: string;
  desc: string;
  /** Optional internal link the card opens on click. Featured cards
   *  always show the open-arrow affordance; standard cards show it only
   *  on hover when the link is present. */
  href?: string;
  /** Render flag for the bento grid: featured cards span 2 cols on lg
   *  and ship a richer mini-demo visual (visualizer, EQ bars, room
   *  pulse, etc.). Standard cards are uniform 1-col tiles. */
  featured?: boolean;
  /** Mini-demo renderer for featured cards. Hover-only motion is
   *  expressed inside the demo itself via Tailwind's `group-hover:`
   *  classes — no JS hover tracking needed. */
  demo?: () => React.ReactNode;
}

/**
 * 9 product-truth features mapped from the actual codebase:
 *
 *   1. Override (TrackOverrideModal + /tracks/:id/override) — replace
 *      a Tidal track's stream with the user's own file. Featured.
 *   2. Listening Rooms (/rooms + ChatRoomDO) — synchronised group
 *      playback with live chat over a Cloudflare Durable Object.
 *      Featured.
 *   3. AI Playlists (/ai + AiPlaylistService) — describe the mood,
 *      get a generated playlist out of the real Tidal catalog.
 *      Featured.
 *   4. 24-bit lossless (HI_RES_LOSSLESS quality through Tidal).
 *   5. Crossfade & gapless (two-slot WebAudio engine in
 *      useAudioPlayer.ts).
 *   6. 10-band EQ (Equalizer.tsx + BiquadFilter chain).
 *   7. Synced lyrics (LyricsPanel.tsx, line-by-line karaoke).
 *   8. Uploads (UploadsPage + R2-backed user_tracks).
 *   9. Playlist sharing by link (/p/:token + SharePlaylistDialog).
 */
const features: Feature[] = [
  {
    icon: Replace,
    title: 'Поверх цензуры — твоя версия',
    desc: 'Загружаешь оригинал — он подменяет вырезанный или приглушённый трек прямо в каталоге. Никто, кроме тебя, не видит подмены.',
    featured: true,
    demo: () => <CensorshipDemo />,
  },
  {
    icon: Headphones,
    title: '24-bit lossless',
    desc: 'Когда в каталоге есть мастер — слышишь мастер. Никаких mp3 на 128 и значков «HD» поверх обычного потока.',
  },
  {
    icon: Users,
    title: 'Слушать вместе',
    desc: 'Создаёшь комнату — кидаешь ссылку. Плеер у всех синхронен до миллисекунд, в чате обсуждаете трек, хост рулит очередью.',
    href: '/rooms',
    featured: true,
    demo: () => <RoomsDemo />,
  },
  {
    icon: Sparkles,
    title: 'Плейлисты по запросу',
    desc: 'Опиши настроение или сюжет — ИИ соберёт плейлист из реального каталога. Сохраняешь как свой и слушаешь без редактирования.',
    href: '/ai',
    featured: true,
    demo: () => <AiDemo />,
  },
  {
    icon: Sliders,
    title: '10-band EQ',
    desc: 'Свои пресеты под наушники, машину, кухню. Один раз настроил — едет за тобой между устройствами.',
  },
  {
    icon: Bolt,
    title: 'Crossfade и gapless',
    desc: 'Альбомы играют без чёрной дыры между треками. Следующий подмешиваем сверху — щелчков и пауз нет.',
  },
  {
    icon: MicVocal,
    title: 'Синхронные лирики',
    desc: 'Текст летит за вокалом строкой в строку. Полноэкранный режим превращает плеер в караоке без сторонних приложений.',
  },
  {
    icon: UploadCloud,
    title: 'Свои треки в облако',
    desc: 'Заливаешь редкий релиз или собственный трек — он живёт в библиотеке наравне с Tidal. Лайки, плейлисты, очередь — как обычно.',
  },
  {
    icon: Share2,
    title: 'Плейлист одной ссылкой',
    desc: 'Кидаешь URL — собеседник открывает и слушает то же. Без логинов, без баннера «установите наше приложение».',
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
            9 фич, которые делают этот плеер. Никакого маркетинга — только то, что реально работает.
          </p>
        </Reveal>

        {/*
         * Bento layout:
         *   - mobile: 1-col stack
         *   - sm: 2-col, featured cards span both columns to keep
         *     their mini-demos legible
         *   - lg: 3-col, featured cards span 2 columns and get the
         *     full mini-demo treatment
         * Auto-flow + dense lets featured/standard cards interleave
         * without leaving holes when the order would otherwise
         * stagger oddly across breakpoints.
         */}
        <Stagger className="grid auto-rows-[minmax(220px,auto)] grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 lg:[grid-auto-flow:dense]">
          {features.map((f) => (
            <FeatureTile key={f.title} feature={f} />
          ))}
        </Stagger>
      </section>
    </div>
  );
}

/**
 * Single bento tile. Featured tiles get more vertical real estate
 * (`row-span-2` on lg) so the mini-demo has room to breathe, and
 * `col-span-2` so the title doesn't wrap awkwardly next to the demo.
 * Standard tiles stay 1×1 with the same visual rhythm as before.
 */
function FeatureTile({ feature }: { feature: Feature }) {
  const Icon = feature.icon;
  const reduce = useReducedMotion();
  const isFeatured = Boolean(feature.featured);

  const card = (
    <TiltCard
      intensity={isFeatured ? 6 : 8}
      hoverScale={1.015}
      className="h-full rounded-[var(--radius-lg)]"
    >
      <motion.div
        whileHover={reduce ? undefined : 'hover'}
        initial="rest"
        animate="rest"
        className={cn(
          'group relative flex h-full flex-col gap-3 overflow-hidden rounded-[var(--radius-lg)] border border-border bg-card p-6 transition-colors hover:border-[var(--color-border-strong)]',
          isFeatured && 'sm:p-7',
        )}
      >
        {/* Cursor-follow accent halo. Lives behind everything else and
            pops in on hover. Featured cards get a stronger halo so the
            tile reads as the focal point of its row. */}
        <motion.div
          variants={{
            rest: { opacity: 0 },
            hover: { opacity: 1 },
          }}
          transition={{ duration: 0.5, ease: EASE }}
          className="pointer-events-none absolute -right-24 -top-24 h-48 w-48 rounded-full blur-3xl"
          style={{
            background:
              'radial-gradient(circle, var(--color-accent-glow) 0%, transparent 70%)',
          }}
          aria-hidden
        />
        {isFeatured && (
          <motion.div
            variants={{
              rest: { opacity: 0.25 },
              hover: { opacity: 0.55 },
            }}
            transition={{ duration: 0.5, ease: EASE }}
            className="pointer-events-none absolute -bottom-32 -left-16 h-64 w-64 rounded-full blur-3xl"
            style={{
              background:
                'radial-gradient(circle, var(--color-sub-accent) 0%, transparent 65%)',
            }}
            aria-hidden
          />
        )}

        <div className="relative flex items-center justify-between">
          <motion.div
            variants={{
              rest: { rotate: 0, scale: 1 },
              hover: reduce ? { rotate: 0, scale: 1 } : { rotate: -6, scale: 1.08 },
            }}
            transition={{ type: 'spring', stiffness: 320, damping: 18 }}
            className="flex h-9 w-9 items-center justify-center rounded-[var(--radius-sm)] border border-border bg-background text-foreground"
            style={{ transform: 'translateZ(40px)' }}
          >
            <Icon size={16} />
          </motion.div>
          {feature.href && (
            <motion.span
              variants={{
                rest: { opacity: 0, x: -4 },
                hover: { opacity: 1, x: 0 },
              }}
              transition={{ duration: 0.3, ease: EASE }}
              className="relative inline-flex items-center gap-1 text-xs font-medium text-[var(--color-accent)]"
              style={{ transform: 'translateZ(40px)' }}
            >
              Открыть <ArrowUpRight size={12} />
            </motion.span>
          )}
        </div>

        <p
          className="relative text-base font-semibold tracking-tight"
          style={{ transform: 'translateZ(30px)' }}
        >
          {feature.title}
        </p>
        <p
          className="relative text-sm leading-relaxed text-muted-foreground"
          style={{ transform: 'translateZ(20px)' }}
        >
          {feature.desc}
        </p>

        {isFeatured && feature.demo && (
          <div
            className="relative mt-auto pt-3"
            style={{ transform: 'translateZ(15px)' }}
          >
            {feature.demo()}
          </div>
        )}
      </motion.div>
    </TiltCard>
  );

  return (
    <motion.div
      variants={staggerItem}
      className={cn(
        isFeatured && 'sm:col-span-2 lg:col-span-2',
      )}
    >
      {feature.href ? (
        <Link to={feature.href} className="block h-full">
          {card}
        </Link>
      ) : (
        card
      )}
    </motion.div>
  );
}

/**
 * Censorship-override demo: shows a censored "[—]" placeholder that
 * gets replaced on hover with the unredacted waveform. Captures the
 * product pitch in a single visual without needing copy.
 */
function CensorshipDemo() {
  return (
    <div className="relative h-12 w-full overflow-hidden rounded-md border border-border bg-background">
      {/* Censored row */}
      <div className="absolute inset-0 flex items-center gap-1.5 px-3 transition-opacity duration-500 group-hover:opacity-0">
        {Array.from({ length: 18 }).map((_, i) => (
          <span
            key={i}
            className="h-2 flex-1 rounded-full bg-[var(--color-text-subtle)]/30"
            style={{ opacity: i % 5 === 2 || i % 7 === 4 ? 0.15 : 0.6 }}
          />
        ))}
        <span className="ml-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          censored
        </span>
      </div>
      {/* Restored row */}
      <div className="absolute inset-0 flex items-center gap-1.5 px-3 opacity-0 transition-opacity duration-500 group-hover:opacity-100">
        {Array.from({ length: 18 }).map((_, i) => {
          // Asymmetric heights → looks like a real waveform. Pseudo-
          // random but deterministic so SSR doesn't flicker.
          const h = ((i * 137) % 9) + 4;
          return (
            <span
              key={i}
              className="flex-1 rounded-full bg-[var(--color-accent)]"
              style={{ height: `${h}px` }}
            />
          );
        })}
        <span className="ml-2 text-[10px] font-medium uppercase tracking-wider text-[var(--color-accent)]">
          your cut
        </span>
      </div>
    </div>
  );
}

/**
 * Listening-rooms demo: three "user pulses" syncing to the same beat.
 * Hover speeds up the pulse so the synchronisation reads as live.
 */
function RoomsDemo() {
  const reduce = useReducedMotion();
  return (
    <div className="relative flex h-12 w-full items-center justify-between rounded-md border border-border bg-background px-3">
      <div className="flex items-center gap-2">
        {[0, 1, 2].map((i) => (
          <motion.div
            key={i}
            initial={false}
            animate={reduce ? undefined : { scale: [1, 1.08, 1] }}
            transition={{
              duration: 1.6,
              repeat: Infinity,
              ease: EASE,
              delay: i * 0.05,
            }}
            className="relative flex h-7 w-7 items-center justify-center rounded-full border border-border bg-card text-[10px] font-semibold uppercase text-muted-foreground"
          >
            {String.fromCharCode(65 + i)}
            <span
              className="absolute -inset-0.5 rounded-full border border-[var(--color-accent)]/40 opacity-0 transition-opacity group-hover:opacity-100"
              aria-hidden
            />
          </motion.div>
        ))}
      </div>
      <div className="flex items-center gap-1.5">
        <Radio size={12} className="text-[var(--color-accent)]" />
        <span className="font-mono text-[11px] text-muted-foreground">
          02:14 / 03:42
        </span>
      </div>
    </div>
  );
}

/**
 * AI-playlist demo: a faux prompt resolves into a generated playlist
 * row count on hover. Communicates "describe → playlist" in two
 * frames.
 */
function AiDemo() {
  return (
    <div className="relative flex h-12 w-full items-center justify-between gap-3 overflow-hidden rounded-md border border-border bg-background px-3">
      <div className="flex min-w-0 items-center gap-2 text-xs">
        <Sparkles size={12} className="shrink-0 text-[var(--color-accent)]" />
        <span className="truncate font-mono text-muted-foreground transition-opacity duration-500 group-hover:opacity-0">
          «дрифт по ночному МКАД»
        </span>
        <span className="absolute left-3 right-3 truncate font-mono text-foreground opacity-0 transition-opacity duration-500 group-hover:opacity-100">
          → 24 трека • 1ч 38м
        </span>
      </div>
    </div>
  );
}
