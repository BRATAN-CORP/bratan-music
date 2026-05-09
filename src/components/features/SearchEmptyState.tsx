import { Link } from 'react-router-dom';
import { AlertCircle, Clock, Compass, Disc3, Sparkles, Users, Wand2, X } from 'lucide-react';
import { motion } from 'motion/react';
import { ExploreModules } from '@/components/features/ExploreModules';
import { ExploreFeedSkeleton } from '@/components/ui/Skeleton';
import { useExplore } from '@/hooks/useExplore';
import { useT } from '@/i18n';

interface SearchEmptyStateProps {
  recent: string[];
  onPick: (q: string) => void;
  onRemove: (q: string) => void;
  onClear: () => void;
}

const recentCx =
  'group relative flex items-center gap-2 rounded-full border border-border bg-card px-4 py-1.5 text-sm transition-colors hover:bg-secondary';

/**
 * Search-page empty state. The user explicitly asked us to retire the
 * standalone /explore page and surface its content here instead so the
 * search tab is the single discovery hub. We render, top to bottom:
 *   1. Three themed shortcut cards (AI playlist, My Wave, Rooms) —
 *      the page reads as a full discovery hub even before the
 *      Tidal feed lands and works as a fallback when the feed
 *      errors out.
 *   2. Recent queries (when present)
 *   3. The full live Tidal Explore feed via `<ExploreModules>` —
 *      genre tiles, mood/decade rows, editorial playlists, new
 *      tracks, top artists. Same modules ExplorePage rendered.
 */
export function SearchEmptyState({ recent, onPick, onRemove, onClear }: SearchEmptyStateProps) {
  const t = useT();
  const hasRecent = recent.length > 0;
  const { data: explore, isLoading: exploreLoading, error: exploreError } = useExplore();

  return (
    <div className="flex min-w-0 flex-col gap-10">
      <SearchHeroShortcuts />

      {hasRecent && (
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-sm font-semibold tracking-tight">
              <Clock size={14} className="text-muted-foreground" />
              {t('search.recentTitle')}
            </h2>
            <button
              type="button"
              onClick={onClear}
              className="text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              {t('search.recentClear')}
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {recent.map((q, i) => (
              <motion.div
                key={q}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.18, delay: i * 0.02 }}
                className={recentCx}
              >
                <button
                  type="button"
                  onClick={() => onPick(q)}
                  className="text-left text-foreground"
                >
                  {q}
                </button>
                <button
                  type="button"
                  aria-label={t('search.removeRecent', { query: q })}
                  onClick={() => onRemove(q)}
                  className="ml-1 inline-flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground/70 transition-colors hover:bg-background hover:text-foreground"
                >
                  <X size={11} />
                </button>
              </motion.div>
            ))}
          </div>
        </section>
      )}

      <section className="flex min-w-0 flex-col gap-4">
        <div className="flex items-center gap-2">
          <Compass size={14} className="text-[var(--color-accent)]" />
          <h2 className="text-sm font-semibold tracking-tight">{t('search.discoverTitle')}</h2>
        </div>

        {exploreLoading && <ExploreFeedSkeleton count={3} />}

        {exploreError && (
          <div className="flex flex-col items-center gap-3 rounded-[var(--radius-md)] border border-border bg-card py-12 text-center">
            <AlertCircle size={20} className="text-[var(--color-danger)]" />
            <div className="text-sm">{t('search.exploreFailed')}</div>
            <div className="text-xs text-muted-foreground">
              {exploreError instanceof Error ? exploreError.message : t('search.exploreUnknownError')}
            </div>
          </div>
        )}

        {explore && <ExploreModules modules={explore.modules} parentSlug="explore" />}
      </section>
    </div>
  );
}

/**
 * Three themed entry-point cards rendered above the live Tidal feed.
 * Same idle-gradient + accent-glow recipe used by the
 * `<AiPlaylistPromo>` and `<WaveHero>` cards on /home so the search
 * page reads as part of the same family. On mobile they stack to a
 * single column; ≥ sm we drop into a 3-column grid.
 */
function SearchHeroShortcuts() {
  const t = useT();
  return (
    <section className="grid gap-3 sm:grid-cols-3">
      <ShortcutCard
        to="/ai"
        icon={<Wand2 size={18} />}
        eyebrow={t('search.shortcuts.aiEyebrow')}
        title={t('search.shortcuts.aiTitle')}
        hint={t('search.shortcuts.aiHint')}
        accent="accent"
      />
      <ShortcutCard
        to="/home"
        icon={<Disc3 size={18} />}
        eyebrow={t('search.shortcuts.waveEyebrow')}
        title={t('search.shortcuts.waveTitle')}
        hint={t('search.shortcuts.waveHint')}
        accent="sub"
      />
      <ShortcutCard
        to="/rooms"
        icon={<Users size={18} />}
        eyebrow={t('search.shortcuts.roomsEyebrow')}
        title={t('search.shortcuts.roomsTitle')}
        hint={t('search.shortcuts.roomsHint')}
        accent="soft"
      />
    </section>
  );
}

/**
 * One of the search-hero shortcut tiles. Three accent variants drive
 * the idle-gradient hue so the row reads as a coherent triptych
 * (warm accent → cool sub-accent → muted soft) instead of three
 * identical cards. Hover treatment matches `<AiPlaylistPromo>`:
 * accent-glow blob fades in from the top-right, the icon chip
 * gently scales, and the border lightens.
 */
function ShortcutCard({
  to,
  icon,
  eyebrow,
  title,
  hint,
  accent,
}: {
  to: string;
  icon: React.ReactNode;
  eyebrow: string;
  title: string;
  hint: string;
  accent: 'accent' | 'sub' | 'soft';
}) {
  // Per-variant idle gradient + chip styling. Kept inline (CSS vars)
  // so the colours respect the active theme without a Tailwind config
  // round-trip — same recipe AiPlaylistPromo / WaveHero use.
  const gradient =
    accent === 'accent'
      ? 'radial-gradient(110% 70% at 100% 0%, var(--color-accent-soft) 0%, transparent 55%), radial-gradient(80% 60% at 0% 100%, color-mix(in oklab, var(--color-sub-accent) 14%, transparent) 0%, transparent 60%)'
      : accent === 'sub'
        ? 'radial-gradient(110% 70% at 100% 0%, color-mix(in oklab, var(--color-sub-accent) 22%, transparent) 0%, transparent 55%), radial-gradient(80% 60% at 0% 100%, var(--color-accent-soft) 0%, transparent 60%)'
        : 'radial-gradient(110% 70% at 100% 0%, color-mix(in oklab, var(--color-accent) 8%, transparent) 0%, transparent 55%)';
  const chipBg =
    accent === 'accent'
      ? 'bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
      : accent === 'sub'
        ? 'bg-[color-mix(in_oklab,var(--color-sub-accent)_24%,transparent)] text-[var(--color-sub-accent,var(--color-accent))]'
        : 'bg-secondary text-foreground';
  return (
    <Link
      to={to}
      className="group relative isolate flex min-h-[120px] flex-col justify-between gap-3 overflow-hidden rounded-[var(--radius-lg)] border border-border bg-card p-4 transition-all hover:-translate-y-0.5 hover:border-[var(--color-border-strong)] hover:shadow-[var(--shadow-md)]"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
        style={{ background: gradient }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -right-16 -top-16 -z-10 h-40 w-40 rounded-full opacity-0 blur-3xl transition-opacity duration-500 group-hover:opacity-100"
        style={{
          background: 'radial-gradient(circle, var(--color-accent-glow) 0%, transparent 70%)',
        }}
      />
      <div className="flex items-center gap-2.5">
        <div
          className={
            'flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-md)] transition-transform duration-500 group-hover:scale-105 ' +
            chipBg
          }
        >
          {icon}
        </div>
        <span className="text-[11px] font-medium uppercase tracking-[0.22em] text-muted-foreground">
          {eyebrow}
        </span>
      </div>
      <div className="flex min-w-0 flex-col gap-1">
        <span className="truncate text-base font-semibold tracking-tight">{title}</span>
        <span className="line-clamp-2 text-xs text-muted-foreground">{hint}</span>
      </div>
      <Sparkles
        size={12}
        aria-hidden
        className="absolute right-3 top-3 text-muted-foreground/40 transition-colors group-hover:text-[var(--color-accent)]"
      />
    </Link>
  );
}
