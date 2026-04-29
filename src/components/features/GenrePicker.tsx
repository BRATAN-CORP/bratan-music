import { useState } from 'react';
import { motion, useReducedMotion, AnimatePresence } from 'motion/react';
import { Sparkles, Check, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { setGenreSeeds } from '@/lib/recommendations';
import { EASE_SPRING as EASE } from '@/lib/motion';
import { cn } from '@/lib/utils';

/**
 * Cold-start onboarding card. Lets a brand-new user pick 3+ genres
 * which then seed the wave / daily-playlists until real listening
 * history accumulates. Closeable — but the home page only renders
 * it for users with no taste signal at all, so closing it just
 * means they'll see a generic global wave.
 */

interface Genre {
  slug: string;
  label: string;
  /** Decorative emoji-style accent — the cards rely on text + chip
   *  color, not photographic covers, since we'd need to round-trip
   *  Tidal for cover art and the picker should be instant. */
  emoji: string;
  hue: string; // tailwind-friendly color used in the chip glow
}

// Tidal genre page slugs. The first column is what we send to the
// backend; if Tidal doesn't recognise one of them the cold-start
// fallback (global popular) catches it transparently — we never
// surface a hard error here.
const GENRES: Genre[] = [
  { slug: 'genre_pop', label: 'Поп', emoji: '✨', hue: '#f43f5e' },
  { slug: 'genre_rap', label: 'Рэп / Hip-Hop', emoji: '🎤', hue: '#a855f7' },
  { slug: 'genre_rock', label: 'Рок', emoji: '🎸', hue: '#dc2626' },
  { slug: 'genre_electronic', label: 'Электроника', emoji: '🎛️', hue: '#06b6d4' },
  { slug: 'genre_rb_soul', label: 'R&B / Soul', emoji: '💜', hue: '#9333ea' },
  { slug: 'genre_indie', label: 'Indie', emoji: '🌿', hue: '#22c55e' },
  { slug: 'genre_jazz', label: 'Джаз', emoji: '🎷', hue: '#eab308' },
  { slug: 'genre_classical', label: 'Классика', emoji: '🎻', hue: '#a16207' },
  { slug: 'genre_metal', label: 'Метал', emoji: '⚡', hue: '#0f172a' },
  { slug: 'genre_country', label: 'Кантри / Folk', emoji: '🌾', hue: '#65a30d' },
  { slug: 'genre_world', label: 'Этника / Мир', emoji: '🌍', hue: '#0ea5e9' },
  { slug: 'genre_dance', label: 'Dance / EDM', emoji: '🪩', hue: '#ec4899' },
];

const MIN_PICKS = 3;
const MAX_PICKS = 8;

interface GenrePickerProps {
  onComplete: () => void;
  onSkip?: () => void;
}

export function GenrePicker({ onComplete, onSkip }: GenrePickerProps) {
  const reduce = useReducedMotion();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);

  const toggle = (slug: string) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else if (next.size < MAX_PICKS) next.add(slug);
      return next;
    });
  };

  const submit = async () => {
    if (picked.size < MIN_PICKS) return;
    setSubmitting(true);
    try {
      await setGenreSeeds([...picked]);
      onComplete();
    } catch {
      setSubmitting(false);
    }
  };

  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 12 }}
      animate={reduce ? undefined : { opacity: 1, y: 0 }}
      transition={{ duration: 0.7, ease: EASE }}
      className="relative overflow-hidden rounded-[var(--radius-2xl)] border border-border bg-card p-6 sm:p-8"
    >
      <div className="pointer-events-none absolute inset-0 opacity-50" aria-hidden>
        <div
          className="absolute -left-20 -top-20 h-[320px] w-[320px] rounded-full opacity-50 blur-3xl"
          style={{ background: 'radial-gradient(circle, var(--color-accent) 0%, transparent 70%)' }}
        />
      </div>

      {onSkip && (
        <button
          onClick={onSkip}
          aria-label="Закрыть"
          className="absolute right-4 top-4 z-10 rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-[var(--color-hover-overlay)] hover:text-foreground"
        >
          <X size={16} />
        </button>
      )}

      <div className="relative">
        <div className="inline-flex items-center gap-2 rounded-full border border-border bg-[var(--color-surface-elevated)] px-3 py-1.5 text-xs font-medium text-muted-foreground backdrop-blur">
          <Sparkles size={12} className="text-[var(--color-accent)]" />
          Настроим вкус
        </div>

        <h2 className="mt-4 max-w-2xl text-3xl font-semibold tracking-tight sm:text-4xl">
          Что тебе сейчас зайдёт?
        </h2>
        <p className="mt-2 max-w-xl text-sm text-muted-foreground">
          Выбери {MIN_PICKS}–{MAX_PICKS} жанров. Это нужно только чтобы первая «Моя волна» не была случайной — дальше всё подстроится под то, что ты слушаешь.
        </p>

        <div className="mt-6 flex flex-wrap gap-2">
          {GENRES.map((g) => {
            const on = picked.has(g.slug);
            return (
              <motion.button
                key={g.slug}
                type="button"
                onClick={() => toggle(g.slug)}
                whileTap={{ scale: 0.96 }}
                className={cn(
                  'group relative inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition-all',
                  on
                    ? 'border-transparent bg-foreground text-background shadow-[0_4px_16px_-4px_var(--color-accent-glow)]'
                    : 'border-border bg-[var(--color-surface-elevated)] text-foreground hover:border-[var(--color-border-strong)] hover:bg-[var(--color-hover-overlay)]',
                )}
                style={
                  on
                    ? {
                        boxShadow: `0 4px 24px -8px ${g.hue}55, inset 0 0 0 1px ${g.hue}88`,
                      }
                    : undefined
                }
              >
                <span aria-hidden>{g.emoji}</span>
                <span>{g.label}</span>
                <AnimatePresence>
                  {on && (
                    <motion.span
                      initial={{ opacity: 0, scale: 0.6 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.6 }}
                      transition={{ duration: 0.2 }}
                      className="ml-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full bg-background/20"
                    >
                      <Check size={10} />
                    </motion.span>
                  )}
                </AnimatePresence>
              </motion.button>
            );
          })}
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Button
            variant="primary"
            size="lg"
            disabled={picked.size < MIN_PICKS || submitting}
            onClick={submit}
            className="gap-2"
          >
            {submitting ? 'Сохраняем…' : (
              <>
                <Sparkles size={16} />
                Запустить волну
              </>
            )}
          </Button>
          <span className="text-sm text-muted-foreground">
            {picked.size < MIN_PICKS
              ? `Ещё ${MIN_PICKS - picked.size}…`
              : `${picked.size}/${MAX_PICKS} выбрано`}
          </span>
        </div>
      </div>
    </motion.div>
  );
}
