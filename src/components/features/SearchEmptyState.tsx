import { Clock, Compass, Loader2, Sparkles, X } from 'lucide-react';
import { motion } from 'motion/react';
import { Link } from 'react-router-dom';
import { useExplore } from '@/hooks/useExplore';
import type { ExplorePageLink } from '@/types';

interface SearchEmptyStateProps {
  recent: string[];
  onPick: (q: string) => void;
  onRemove: (q: string) => void;
  onClear: () => void;
}

const cardCx =
  'group relative flex items-center gap-2 rounded-[var(--radius-md)] border border-border bg-card px-3 py-2 text-sm transition-colors hover:bg-secondary';

export function SearchEmptyState({ recent, onPick, onRemove, onClear }: SearchEmptyStateProps) {
  const hasRecent = recent.length > 0;
  const { data: explore, isLoading: exploreLoading } = useExplore();

  // Pick the link clouds straight from the Tidal Explore page so the
  // search empty state always reflects the live taxonomy (genres,
  // moods, decades). Falls back to nothing while loading — the
  // recent-queries section keeps the page from feeling empty.
  const linkSections = (explore?.modules ?? [])
    .filter((m): m is { type: 'pageLinks'; title: string; items: ExplorePageLink[] } => m.type === 'pageLinks')
    .slice(0, 3);

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
                className={cardCx}
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

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-sm font-semibold tracking-tight">
            <Compass size={14} className="text-[var(--color-accent)]" />
            Подборки от Tidal
          </h2>
          <Link
            to="/explore"
            className="text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            Открыть обзор
          </Link>
        </div>

        {exploreLoading && linkSections.length === 0 && (
          <div className="flex items-center justify-center gap-2 py-10 text-xs text-muted-foreground">
            <Loader2 size={14} className="animate-spin" />
            Загружаем подборки…
          </div>
        )}

        {linkSections.map((section, idx) => (
          <div key={section.title + idx} className="flex flex-col gap-2">
            <h3 className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
              {idx > 0 ? <Sparkles size={11} /> : null}
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
