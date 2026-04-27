import { Clock, Sparkles, TrendingUp, X } from 'lucide-react';
import { motion } from 'motion/react';
import { TiltCard } from '@/components/ui/TiltCard';

interface SearchEmptyStateProps {
  recent: string[];
  onPick: (q: string) => void;
  onRemove: (q: string) => void;
  onClear: () => void;
}

// Curated themes — keep light and rotated so the empty state never feels static.
// Order matters: first row reads as "trending", second as "moods/genres".
const TRENDING: { label: string; query: string }[] = [
  { label: 'Brazilian Phonk', query: 'brazilian phonk' },
  { label: 'Hyperpop 2025', query: 'hyperpop 2025' },
  { label: 'Drift Phonk', query: 'drift phonk' },
  { label: 'Lo-fi Beats', query: 'lo-fi beats' },
  { label: 'Russian Rap', query: 'русский рэп' },
  { label: 'Synthwave', query: 'synthwave' },
];

const MOODS: { label: string; query: string }[] = [
  { label: 'Сфокусироваться', query: 'focus instrumental' },
  { label: 'Спортзал', query: 'workout hits' },
  { label: 'За рулём', query: 'driving playlist' },
  { label: 'Уснуть', query: 'sleep ambient' },
  { label: 'Танцевать', query: 'club dance hits' },
  { label: 'Кодить', query: 'coding lo-fi' },
];

const cardCx =
  'group relative flex items-center gap-2 rounded-[var(--radius-md)] border border-border bg-card px-3 py-2 text-sm transition-colors hover:bg-secondary';

export function SearchEmptyState({ recent, onPick, onRemove, onClear }: SearchEmptyStateProps) {
  const hasRecent = recent.length > 0;

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
        <h2 className="flex items-center gap-2 text-sm font-semibold tracking-tight">
          <TrendingUp size={14} className="text-[var(--color-accent)]" />
          В тренде
        </h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {TRENDING.map((it, i) => (
            <motion.div
              key={it.query}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.22, delay: i * 0.03, ease: [0.16, 1, 0.3, 1] }}
            >
              {/* Same TiltCard treatment as the landing-page feature
                  cards: parallax tilt, scale-on-hover, glare follows the
                  cursor. The inner element stays a real <button> so
                  click-to-search and keyboard activation behave normally. */}
              <TiltCard intensity={8} className="h-full rounded-[var(--radius-md)]">
                <button
                  type="button"
                  onClick={() => onPick(it.query)}
                  className="group relative flex h-full w-full flex-col items-start justify-end gap-1 overflow-hidden rounded-[var(--radius-md)] border border-border bg-card p-4 text-left transition-colors hover:border-[var(--color-accent-soft)] hover:bg-secondary"
                >
                  <span
                    aria-hidden
                    className="pointer-events-none absolute -right-6 -top-6 h-20 w-20 rounded-full opacity-0 blur-2xl transition-opacity duration-500 group-hover:opacity-100"
                    style={{
                      background:
                        'radial-gradient(circle, var(--color-accent-glow) 0%, transparent 70%)',
                    }}
                  />
                  <span
                    className="relative text-xs uppercase tracking-[0.2em] text-muted-foreground"
                    style={{ transform: 'translateZ(20px)' }}
                  >
                    #{i + 1}
                  </span>
                  <span
                    className="relative text-sm font-semibold leading-snug"
                    style={{ transform: 'translateZ(30px)' }}
                  >
                    {it.label}
                  </span>
                </button>
              </TiltCard>
            </motion.div>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold tracking-tight">
          <Sparkles size={14} className="text-muted-foreground" />
          Под настроение
        </h2>
        <div className="flex flex-wrap gap-2">
          {MOODS.map((it) => (
            <button
              key={it.query}
              type="button"
              onClick={() => onPick(it.query)}
              className="rounded-full border border-border bg-card px-4 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              {it.label}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
