import { AlertCircle, Clock, Loader2, X } from 'lucide-react';
import { motion } from 'motion/react';
import { ExploreModules } from '@/components/features/ExploreModules';
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
 * search tab is the single discovery hub. We render:
 *   1. Recent queries (when present)
 *   2. The full live Tidal Explore feed via `<ExploreModules>` —
 *      genre tiles, mood/decade rows, editorial playlists, new
 *      tracks, top artists. Same modules ExplorePage rendered.
 */
export function SearchEmptyState({ recent, onPick, onRemove, onClear }: SearchEmptyStateProps) {
  const t = useT();
  const hasRecent = recent.length > 0;
  const { data: explore, isLoading: exploreLoading, error: exploreError } = useExplore();

  return (
    <div className="flex flex-col gap-10">
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

      {exploreLoading && (
        <div className="flex items-center justify-center gap-2 py-16 text-xs text-muted-foreground">
          <Loader2 size={14} className="animate-spin" />
          {t('search.exploreLoading')}
        </div>
      )}

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
    </div>
  );
}
