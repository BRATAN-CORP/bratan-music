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
import { UserAvatar } from '@/components/ui/UserAvatar';
import { EASE_SPRING as EASE, staggerItem } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { useT, type TranslationKey } from '@/i18n';

/**
 * Stable, made-up listener identities for the listening-rooms demo
 * on the landing. Real listeners aren't visible to unauthed visitors,
 * so we synthesise a plausible 3-person room: distinct first names
 * + Telegram-style usernames seed `UserAvatar` to produce the same
 * gradient + initial render the rest of the app uses for real users
 * (members list in /rooms, chat avatars, profile hero).
 *
 * Seeds picked so the three gradients land on visually distinct hue
 * buckets in `fallbackGradient`'s palette \u2014 reads as "different
 * people listening together", not three copies of the same colour.
 */
const ROOM_DEMO_LISTENERS: ReadonlyArray<{ name: string; username: string }> = [
  { name: 'Alina',  username: 'alinka_synth' },
  { name: 'Marat',  username: 'marat.bass'   },
  { name: 'Sasha',  username: 'sashka.fm'    },
];

type Translate = ReturnType<typeof useT>;

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
  /** Stable identifier used as React key and as the i18n sub-namespace
   *  under `landing.features.<id>` for `.title` / `.desc`. */
  id: string;
  icon: LucideIcon;
  titleKey: TranslationKey;
  descKey: TranslationKey;
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
  demo?: (t: Translate) => React.ReactNode;
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
    id: 'censorOverlay',
    icon: Replace,
    titleKey: 'landing.features.censorOverlay.title',
    descKey: 'landing.features.censorOverlay.desc',
    featured: true,
    demo: (t) => <CensorshipDemo t={t} />,
  },
  {
    id: 'lossless24',
    icon: Headphones,
    titleKey: 'landing.features.lossless24.title',
    descKey: 'landing.features.lossless24.desc',
  },
  {
    id: 'listenTogether',
    icon: Users,
    titleKey: 'landing.features.listenTogether.title',
    descKey: 'landing.features.listenTogether.desc',
    href: '/rooms',
    featured: true,
    demo: () => <RoomsDemo />,
  },
  {
    id: 'aiPlaylists',
    icon: Sparkles,
    titleKey: 'landing.features.aiPlaylists.title',
    descKey: 'landing.features.aiPlaylists.desc',
    href: '/ai',
    featured: true,
    demo: (t) => <AiDemo t={t} />,
  },
  {
    id: 'eq10band',
    icon: Sliders,
    titleKey: 'landing.features.eq10band.title',
    descKey: 'landing.features.eq10band.desc',
  },
  {
    id: 'crossfade',
    icon: Bolt,
    titleKey: 'landing.features.crossfade.title',
    descKey: 'landing.features.crossfade.desc',
  },
  {
    id: 'syncedLyrics',
    icon: MicVocal,
    titleKey: 'landing.features.syncedLyrics.title',
    descKey: 'landing.features.syncedLyrics.desc',
  },
  {
    id: 'uploads',
    icon: UploadCloud,
    titleKey: 'landing.features.uploads.title',
    descKey: 'landing.features.uploads.desc',
  },
  {
    id: 'shareLink',
    icon: Share2,
    titleKey: 'landing.features.shareLink.title',
    descKey: 'landing.features.shareLink.desc',
  },
];

interface Stat {
  value: number;
  suffix: string;
  labelKey: TranslationKey;
}

const stats: Stat[] = [
  { value: 100, suffix: 'M+', labelKey: 'landing.statTracksLabel' },
  { value: 24, suffix: '-bit', labelKey: 'landing.statBitLabel' },
  { value: 99, suffix: 'Stars', labelKey: 'landing.statStarsLabel' },
];

export function LandingPage() {
  const t = useT();
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
            {t('landing.eyebrow')}
          </motion.div>

          <motion.h1
            initial={reduce ? false : { opacity: 0, y: 24 }}
            animate={reduce ? undefined : { opacity: 1, y: 0 }}
            transition={{ duration: 0.9, delay: 0.05, ease: EASE }}
            className="max-w-4xl text-[clamp(2.4rem,6.5vw,5.6rem)] font-semibold leading-[0.98] tracking-tight"
          >
            {t('landing.heroTitlePrefix')} <span className="font-serif italic text-muted-foreground">{t('landing.heroTitleEmphasis')}</span>
            <br />
            <span className="shine-text">{t('landing.heroTitleSuffix')}</span>
          </motion.h1>

          <motion.p
            initial={reduce ? false : { opacity: 0, y: 16 }}
            animate={reduce ? undefined : { opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.15, ease: EASE }}
            className="max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg"
          >
            {t('landing.heroDescription')}
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
                  {t('landing.openSearchCta')}
                  <ArrowUpRight size={16} className="transition-transform group-hover:translate-x-0.5" />
                </Button>
              </Link>
            ) : (
              <TelegramLoginButton />
            )}
          </motion.div>

          <Stagger className="grid w-full max-w-3xl grid-cols-3 gap-4 pt-12 sm:gap-8" delay={0.35}>
            {stats.map((stat) => (
              <motion.div key={stat.labelKey} variants={staggerItem} className="flex flex-col gap-1">
                <div className="text-2xl font-semibold tracking-tight text-foreground sm:text-4xl">
                  <AnimatedNumber value={stat.value} />
                  <span className="text-muted-foreground">{stat.suffix}</span>
                </div>
                <p className="text-xs text-muted-foreground sm:text-sm">{t(stat.labelKey)}</p>
              </motion.div>
            ))}
          </Stagger>
        </div>
      </section>

      <section className="relative mx-auto max-w-6xl px-4 pb-20 pt-12 sm:px-6 sm:pt-0 lg:px-10">
        <Reveal className="mb-10 flex items-end justify-between gap-6 border-b border-border pb-4">
          <div className="flex flex-col gap-2">
            <span className="text-xs font-medium uppercase tracking-[0.25em] text-muted-foreground">
              {t('landing.featuresEyebrow')}
            </span>
            <h2 className="text-2xl font-semibold tracking-tight sm:text-4xl">{t('landing.featuresTitle')}</h2>
          </div>
          <p className="hidden max-w-md text-sm text-muted-foreground sm:block">
            {t('landing.featuresHint')}
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
            <FeatureTile key={f.id} feature={f} t={t} />
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
function FeatureTile({ feature, t }: { feature: Feature; t: Translate }) {
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
              {t('landing.openLink')} <ArrowUpRight size={12} />
            </motion.span>
          )}
        </div>

        <p
          className="relative text-base font-semibold tracking-tight"
          style={{ transform: 'translateZ(30px)' }}
        >
          {t(feature.titleKey)}
        </p>
        <p
          className="relative text-sm leading-relaxed text-muted-foreground"
          style={{ transform: 'translateZ(20px)' }}
        >
          {t(feature.descKey)}
        </p>

        {isFeatured && feature.demo && (
          <div
            className="relative mt-auto pt-3"
            style={{ transform: 'translateZ(15px)' }}
          >
            {feature.demo(t)}
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
 * Censorship-override demo: a single-line phrase that morphs on
 * hover. Idle reads "Don't hear ~~the censor~~" with a strikethrough
 * over the noun; on hover the whole line crossfades through a soft
 * blur into "Hear it uncut", with the noun in accent colour. The
 * spinning vinyl on the left anchors the music context so the demo
 * doesn't read as a generic "click to reveal" pattern. No more
 * decorative redaction bar, no more right-side badge — the phrase
 * itself carries the entire pitch.
 */
function CensorshipDemo({ t }: { t: Translate }) {
  const reduce = useReducedMotion();
  return (
    <div className="relative h-12 w-full overflow-hidden rounded-md border border-border bg-background">
      {/* Ambient accent sweep — a soft glow that scans across the
          surface so the demo doesn't sit dead while idle. Skipped
          under prefers-reduced-motion. */}
      {!reduce && (
        <motion.div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 w-16"
          style={{
            background:
              'linear-gradient(90deg, transparent 0%, color-mix(in oklab, var(--color-accent) 10%, transparent) 50%, transparent 100%)',
          }}
          animate={{ x: ['-50%', '320%'] }}
          transition={{ duration: 5.5, repeat: Infinity, ease: 'linear' }}
        />
      )}

      {/* Spinning vinyl anchors the music context. Continuous slow
          rotation reads as "playing"; rendered as nested rings + an
          accent label dot at the center. */}
      <motion.div
        aria-hidden
        animate={reduce ? undefined : { rotate: 360 }}
        transition={{ duration: 8, repeat: Infinity, ease: 'linear' }}
        className="absolute left-2 top-1/2 -translate-y-1/2 h-8 w-8"
      >
        <div className="relative h-full w-full rounded-full bg-gradient-to-br from-[#1f1f1f] to-[#0a0a0a] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]">
          <div className="absolute inset-1 rounded-full border border-white/5" />
          <div className="absolute inset-2 rounded-full border border-white/5" />
          <div className="absolute left-1/2 top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--color-accent)] shadow-[0_0_8px_var(--color-accent-glow)]" />
        </div>
      </motion.div>

      {/* Crossfade phrase — both states share an invisible width-sizer
          so the layout never reflows. Idle phrase is the "don't"
          variant with a strikethrough on the censored noun; hover
          phrase is the "do" variant with the alternative noun in
          accent colour. Soft blur on the leaving / entering side of
          the swap softens the transition into a single visual gesture. */}
      <div className="absolute left-12 right-3 top-1/2 -translate-y-1/2 font-mono text-[12px] uppercase tracking-[0.16em]">
        <span className="relative inline-block whitespace-nowrap">
          {/* Width-sizer: render both phrases stacked invisibly so the
              container always reserves enough room for the longer one. */}
          <span className="invisible block">
            {t('landing.demos.censorPrefix')} {t('landing.demos.censorWord')}
          </span>
          <span className="invisible block">
            {t('landing.demos.revealPrefix')} {t('landing.demos.revealWord')}
          </span>

          {/* Idle phrase. */}
          <span className="absolute inset-0 flex items-center gap-1.5 text-foreground transition-[opacity,filter] duration-500 ease-out group-hover:opacity-0 group-hover:[filter:blur(3px)]">
            <span>{t('landing.demos.censorPrefix')}</span>
            <span className="line-through decoration-foreground decoration-[1.5px] underline-offset-2">
              {t('landing.demos.censorWord')}
            </span>
          </span>

          {/* Hover phrase — accent on the reveal noun. */}
          <span className="absolute inset-0 flex items-center gap-1.5 opacity-0 [filter:blur(3px)] transition-[opacity,filter] duration-500 ease-out group-hover:opacity-100 group-hover:[filter:blur(0)]">
            <span className="text-foreground">{t('landing.demos.revealPrefix')}</span>
            <span className="font-semibold text-[var(--color-accent)]">
              {t('landing.demos.revealWord')}
            </span>
          </span>
        </span>
      </div>
    </div>
  );
}

/**
 * Listening-rooms demo: a static stack of three real-looking
 * `UserAvatar`s (gradient + initial via the same fixture seeds the
 * rest of the app uses for live users) on the left, paired with a
 * "live" `Radio` icon and a mock playback timestamp on the right.
 *
 * The earlier pulse animation made the gradient avatars look like
 * bobbing heads — fine on the original A/B/C letter circles, awful
 * on real-looking avatars. The static stack reads as "three people
 * in a room" at a glance, and the accent ring still appears on
 * `group-hover` so the card lift remains rewarding.
 */
function RoomsDemo() {
  return (
    <div className="relative flex h-12 w-full items-center justify-between rounded-md border border-border bg-background px-3">
      <div className="flex items-center -space-x-1.5">
        {ROOM_DEMO_LISTENERS.map((listener, i) => (
          <div
            key={listener.username}
            className="relative"
            style={{ zIndex: ROOM_DEMO_LISTENERS.length - i }}
          >
            <UserAvatar
              name={listener.name}
              username={listener.username}
              className="h-7 w-7 rounded-full ring-2 ring-background"
              initialsClassName="text-[10px]"
            />
            <span
              className="pointer-events-none absolute -inset-0.5 rounded-full border border-[var(--color-accent)]/40 opacity-0 transition-opacity group-hover:opacity-100"
              aria-hidden
            />
          </div>
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
function AiDemo({ t }: { t: Translate }) {
  return (
    <div className="relative flex h-12 w-full items-center justify-between gap-3 overflow-hidden rounded-md border border-border bg-background px-3">
      <div className="flex min-w-0 items-center gap-2 text-xs">
        <Sparkles size={12} className="shrink-0 text-[var(--color-accent)]" />
        <span className="truncate font-mono text-muted-foreground transition-opacity duration-500 group-hover:opacity-0">
          {t('landing.demos.aiPrompt')}
        </span>
        <span className="absolute left-3 right-3 truncate font-mono text-foreground opacity-0 transition-opacity duration-500 group-hover:opacity-100">
          {t('landing.demos.aiResult')}
        </span>
      </div>
    </div>
  );
}
