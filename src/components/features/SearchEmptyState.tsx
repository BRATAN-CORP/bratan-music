import { Clock, Compass, Loader2, X } from 'lucide-react';
import { motion } from 'motion/react';
import { Link } from 'react-router-dom';
import { useExplore } from '@/hooks/useExplore';
import type { ExplorePageLink } from '@/types';
import { tidalImageUrl } from '@/lib/tidal-image';

interface SearchEmptyStateProps {
  recent: string[];
  onPick: (q: string) => void;
  onRemove: (q: string) => void;
  onClear: () => void;
}

const recentCx =
  'group relative flex items-center gap-2 rounded-full border border-border bg-card px-4 py-1.5 text-sm transition-colors hover:bg-secondary';

/**
 * Search-page empty state — recent queries + a curated, image-backed
 * grid of Tidal genres / moods. Pulls live data from `/explore` so
 * the surface is always up-to-date with whatever Tidal is featuring,
 * and reuses the same `GenreTile` visual language as the dedicated
 * /explore page so the two surfaces feel cohesive.
 */
export function SearchEmptyState({ recent, onPick, onRemove, onClear }: SearchEmptyStateProps) {
  const hasRecent = recent.length > 0;
  const { data: explore, isLoading: exploreLoading } = useExplore();

  // Take the first pageLinks module (genres) as the rich grid and
  // collect any subsequent ones as fallback pill clouds for moods /
  // decades. Filtering on `imageId` makes sure we never render an
  // empty image card for icon-only items.
  const pageLinkSections = (explore?.modules ?? []).filter(
    (m): m is { type: 'pageLinks'; title: string; items: ExplorePageLink[] } =>
      m.type === 'pageLinks'
  );
  const hero = pageLinkSections.find((s) => s.items.every((it) => Boolean(it.imageId))) ?? null;
  const restSections = pageLinkSections.filter((s) => s !== hero).slice(0, 2);

  return (
    <div className="flex flex-col gap-8">
      {hasRecent && (
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-sm font-semibold tracking-tight">
              <Clock size={14} className="text-muted-foreground" />
              Недавние запросы
            </h2>
            <button
              type="button"
              onClick={onClear}
              className="text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              Очистить
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
                  aria-label={`Удалить «${q}»`}
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

      <section className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-sm font-semibold tracking-tight">
            <Compass size={14} className="text-[var(--color-accent)]" />
            {hero?.title ?? 'Подборки от Tidal'}
          </h2>
          <Link
            to="/explore"
            className="text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            Открыть обзор
          </Link>
        </div>

        {exploreLoading && !hero && (
          <div className="flex items-center justify-center gap-2 py-10 text-xs text-muted-foreground">
            <Loader2 size={14} className="animate-spin" />
            Загружаем подборки…
          </div>
        )}

        {hero && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {hero.items.slice(0, 12).map((it, i) => (
              <CompactGenreTile key={it.slug} item={it} index={i} />
            ))}
          </div>
        )}

        {restSections.map((section, idx) => (
          <div key={section.title + idx} className="mt-4 flex flex-col gap-2">
            <h3 className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
              {section.title}
            </h3>
            <div className="flex flex-wrap gap-2">
              {section.items.slice(0, 18).map((it, i) => (
                <motion.div
                  key={it.slug}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.18, delay: Math.min(i, 12) * 0.012 }}
                >
                  <Link
                    to={`/explore/${it.slug}`}
                    className="inline-flex items-center rounded-full border border-border bg-card px-4 py-1.5 text-xs font-medium text-foreground transition-colors hover:border-[var(--color-accent-soft)] hover:bg-secondary"
                  >
                    {it.title}
                  </Link>
                </motion.div>
              ))}
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}

/**
 * Square genre tile used in the search empty-state grid. A slimmer
 * variant of the /explore hero tile — same visual language but
 * shorter aspect ratio so 12 items fit comfortably above the fold.
 */
function CompactGenreTile({ item, index }: { item: ExplorePageLink; index: number }) {
  const img = tidalImageUrl(item.imageId, 480);
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index, 12) * 0.022, duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
    >
      <Link
        to={`/explore/${item.slug}`}
        className="group relative block aspect-square w-full overflow-hidden rounded-[var(--radius-md)] border border-border bg-secondary transition-transform duration-300 hover:-translate-y-0.5 hover:shadow-xl"
      >
        {img ? (
          <img
            src={img}
            alt={item.title}
            loading="lazy"
            className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.06]"
          />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-[var(--color-accent)]/30 to-transparent" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 p-2.5">
          <span className="line-clamp-2 text-[13px] font-semibold text-white sm:text-sm">
            {item.title}
          </span>
        </div>
      </Link>
    </motion.div>
  );
}
