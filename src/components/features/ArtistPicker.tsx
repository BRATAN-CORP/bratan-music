import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion, useReducedMotion, AnimatePresence } from 'motion/react';
import { Sparkles, Check, X, Search, Loader2, User, Music4 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Reveal } from '@/components/ui/Reveal';
import { TiltCard } from '@/components/ui/TiltCard';
import {
  fetchSuggestedSeedArtists,
  searchSeedArtists,
  setSeedArtists,
  type SeedArtistCandidate,
} from '@/lib/recommendations';
import { EASE_SPRING as EASE } from '@/lib/motion';
import { cn } from '@/lib/utils';

/**
 * Cold-start onboarding card — preferred over the genre picker because
 * artist picks are a much tighter taste signal. The user types or
 * scrolls a popular grid, picks 1–6 artists, and we seed the wave from
 * those artists' radios.
 *
 * The search is a debounced GET to /recommendations/artists/search,
 * which proxies Tidal's content search. When the input is empty we
 * fall back to /artists/suggested — a curated mixed-genre popular pool
 * cached server-side for 24h.
 */

const MIN_PICKS = 1;
const MAX_PICKS = 6;

interface ArtistPickerProps {
  onComplete: () => void;
  onSkip?: () => void;
}

export function ArtistPicker({ onComplete, onSkip }: ArtistPickerProps) {
  const reduce = useReducedMotion();
  const [picked, setPicked] = useState<Map<string, SeedArtistCandidate>>(new Map());
  const [submitting, setSubmitting] = useState(false);
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');

  // 250ms debounce for the search query so we don't hammer the
  // proxy on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 250);
    return () => clearTimeout(t);
  }, [query]);

  const { data: suggested = [] } = useQuery({
    queryKey: ['cold-start', 'suggested-artists'],
    queryFn: fetchSuggestedSeedArtists,
    staleTime: 30 * 60_000,
  });

  const { data: searchResults = [], isFetching: searching } = useQuery({
    queryKey: ['cold-start', 'search-artists', debounced],
    queryFn: () => searchSeedArtists(debounced),
    enabled: debounced.length >= 2,
    staleTime: 5 * 60_000,
  });

  // Always show picked artists at the top of the grid even when they
  // fall out of the current search result — otherwise the user can't
  // see what they have selected.
  const grid: SeedArtistCandidate[] = useMemo(() => {
    const base = debounced.length >= 2 ? searchResults : suggested;
    const seen = new Set<string>();
    const out: SeedArtistCandidate[] = [];
    for (const a of picked.values()) {
      if (!seen.has(a.id)) {
        seen.add(a.id);
        out.push(a);
      }
    }
    for (const a of base) {
      if (!seen.has(a.id)) {
        seen.add(a.id);
        out.push(a);
      }
    }
    return out;
  }, [picked, suggested, searchResults, debounced]);

  const toggle = (artist: SeedArtistCandidate) => {
    setPicked((prev) => {
      const next = new Map(prev);
      if (next.has(artist.id)) {
        next.delete(artist.id);
      } else if (next.size < MAX_PICKS) {
        next.set(artist.id, artist);
      }
      return next;
    });
  };

  const submit = async () => {
    if (picked.size < MIN_PICKS) return;
    setSubmitting(true);
    try {
      await setSeedArtists([...picked.keys()]);
      onComplete();
    } catch {
      setSubmitting(false);
    }
  };

  const isSearchActive = debounced.length >= 2;
  const showEmpty = isSearchActive && !searching && grid.length === picked.size;

  return (
    <Reveal>
      <TiltCard intensity={4} hoverScale={1.005} glareStrength={0.25} className="rounded-[var(--radius-2xl)]">
        <div className="relative overflow-hidden rounded-[var(--radius-2xl)] border border-border bg-card">
          {/* Decorative gradient backdrop. Same shape as WaveHero so the
              two cards feel like a pair: a soft accent glow biased to
              the top-left, plus a second muted glow in the bottom-right
              to balance the composition. We avoid `blur-3xl + opacity`
              wrappers — those create separate compositing layers that
              can render with a visible square edge on the rounded
              corner in some browsers (Chromium GPU rasterisation). */}
          <div className="pointer-events-none absolute inset-0" aria-hidden>
            <div
              className="absolute inset-0 opacity-80"
              style={{
                background:
                  'radial-gradient(120% 80% at 0% 0%, var(--color-accent-soft) 0%, transparent 55%), radial-gradient(80% 60% at 100% 100%, color-mix(in oklab, var(--color-sub-accent) 18%, transparent) 0%, transparent 60%)',
              }}
            />
          </div>

          {onSkip && (
            <button
              onClick={onSkip}
              aria-label="Закрыть"
              className="absolute right-4 top-4 z-20 rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-[var(--color-hover-overlay)] hover:text-foreground"
            >
              <X size={16} />
            </button>
          )}

          <div className="relative grid gap-8 p-6 sm:p-10 lg:gap-10">
            <div className="flex flex-col gap-3">
              <div className="inline-flex w-fit items-center gap-2 rounded-full border border-border bg-[var(--color-surface-elevated)] px-2.5 py-1 text-xs font-medium text-muted-foreground backdrop-blur">
                <Music4 size={12} className="text-[var(--color-accent)]" />
                Настроим вкус
              </div>
              <h2 className="text-3xl font-semibold tracking-tight sm:text-5xl">
                Каких артистов ты{' '}
                <span className="font-serif italic text-muted-foreground">любишь</span>?
              </h2>
              <p className="max-w-xl text-sm text-muted-foreground sm:text-base">
                Достаточно одного — соберём волну из его трек-радио и похожих.
                Дальше всё подстроится под то, что ты слушаешь.
              </p>
            </div>

            <div className="flex items-center gap-2 rounded-[var(--radius-md)] border border-border bg-[var(--color-surface-elevated)] px-3 py-2.5 backdrop-blur">
              <Search size={16} className="text-muted-foreground" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Поиск артистов…"
                className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
              {searching && <Loader2 size={14} className="shrink-0 animate-spin text-muted-foreground" />}
              {query.length > 0 && !searching && (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  aria-label="Очистить поиск"
                  className="shrink-0 rounded-full p-0.5 text-muted-foreground transition-colors hover:bg-[var(--color-hover-overlay)] hover:text-foreground"
                >
                  <X size={14} />
                </button>
              )}
            </div>

            {showEmpty ? (
              <p className="text-sm text-muted-foreground">
                Ничего не нашли. Попробуй другую формулировку.
              </p>
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
                <AnimatePresence initial={false}>
                  {grid.slice(0, 30).map((artist, idx) => {
                    const on = picked.has(artist.id);
                    return (
                      <motion.button
                        key={artist.id}
                        type="button"
                        onClick={() => toggle(artist)}
                        layout
                        initial={reduce ? false : { opacity: 0, y: 12 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -8, scale: 0.94 }}
                        transition={{
                          type: 'spring',
                          stiffness: 280,
                          damping: 26,
                          // Stagger only the initial render so picks-driven
                          // re-orders animate instantly instead of cascading.
                          delay: reduce ? 0 : Math.min(idx * 0.025, 0.3),
                        }}
                        whileHover={reduce ? undefined : { y: -2, scale: 1.02 }}
                        whileTap={{ scale: 0.96 }}
                        className={cn(
                          'group relative flex flex-col items-center gap-2.5 rounded-[var(--radius-lg)] border bg-[var(--color-surface-elevated)] p-3 text-center backdrop-blur transition-colors',
                          on
                            ? 'border-transparent'
                            : 'border-border hover:border-[var(--color-border-strong)] hover:bg-[var(--color-hover-overlay)]',
                        )}
                        style={
                          on
                            ? {
                                boxShadow:
                                  '0 12px 32px -16px var(--color-accent-glow), inset 0 0 0 2px var(--color-accent)',
                              }
                            : undefined
                        }
                      >
                        <div className="relative aspect-square w-full overflow-hidden rounded-full">
                          <ArtistAvatar artist={artist} />
                          <AnimatePresence>
                            {on && (
                              <motion.div
                                initial={{ opacity: 0, scale: 0.6 }}
                                animate={{ opacity: 1, scale: 1 }}
                                exit={{ opacity: 0, scale: 0.6 }}
                                transition={{ duration: 0.2, ease: EASE }}
                                className="absolute inset-0 flex items-center justify-center bg-[var(--color-accent)]/45 backdrop-blur-[2px]"
                              >
                                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--color-accent)] text-white shadow-[0_4px_16px_-4px_var(--color-accent-glow)]">
                                  <Check size={16} strokeWidth={3} />
                                </span>
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>
                        <span className="line-clamp-2 text-xs font-medium leading-tight">
                          {artist.name}
                        </span>
                      </motion.button>
                    );
                  })}
                </AnimatePresence>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-3">
              <motion.div whileTap={reduce ? undefined : { scale: 0.97 }}>
                <Button
                  variant="primary"
                  size="lg"
                  disabled={picked.size < MIN_PICKS || submitting}
                  onClick={submit}
                  className="gap-2 px-7"
                >
                  {submitting ? (
                    <>
                      <Loader2 size={16} className="animate-spin" />
                      Сохраняем…
                    </>
                  ) : (
                    <>
                      <Sparkles size={16} />
                      Запустить волну
                    </>
                  )}
                </Button>
              </motion.div>
              <span className="text-sm text-muted-foreground">
                {picked.size === 0
                  ? `Выбери от ${MIN_PICKS} до ${MAX_PICKS}`
                  : `${picked.size}/${MAX_PICKS} выбрано`}
              </span>
            </div>
          </div>
        </div>
      </TiltCard>
    </Reveal>
  );
}

/**
 * Artist avatar with double-layered fallback: if `imageUrl` is missing
 * we never render the <img> at all, and if it's present but fails to
 * load (Tidal CDN miss / 404 / CORS), we swap to the same icon
 * placeholder mid-render. Matches the look of the search results page.
 */
function ArtistAvatar({ artist }: { artist: SeedArtistCandidate }) {
  const [errored, setErrored] = useState(false);
  const showImage = !!artist.imageUrl && !errored;
  return showImage ? (
    <img
      src={artist.imageUrl}
      alt={artist.name}
      loading="lazy"
      onError={() => setErrored(true)}
      className="h-full w-full object-cover"
    />
  ) : (
    <div className="flex h-full w-full items-center justify-center bg-secondary text-muted-foreground">
      <User size={28} />
    </div>
  );
}
