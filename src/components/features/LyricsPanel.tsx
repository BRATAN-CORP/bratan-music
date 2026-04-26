import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { Loader2, X } from 'lucide-react';
import { useLyrics, parseLrc, type LyricLine } from '@/hooks/useLyrics';
import { usePlayerStore } from '@/store/player';

interface LyricsContentProps {
  trackId: string;
}

/**
 * Inner lyrics view — fetches, parses and renders the (possibly synced)
 * lyrics in Apple-Music style. Has no positioning of its own so it can be
 * embedded as a side panel on desktop or as a full-screen overlay on mobile.
 */
function LyricsContent({ trackId }: LyricsContentProps) {
  const { data, isLoading, isError } = useLyrics(trackId);
  const progress = usePlayerStore((s) => s.progress);

  const lines: LyricLine[] = useMemo(() => {
    if (!data?.subtitles) return [];
    return parseLrc(data.subtitles);
  }, [data?.subtitles]);

  const activeIndex = useMemo(() => {
    if (!lines.length) return -1;
    let lo = 0;
    let hi = lines.length - 1;
    let result = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const t = lines[mid]?.time ?? Infinity;
      if (t <= progress) {
        result = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return result;
  }, [lines, progress]);

  return (
    <LyricsBody
      isLoading={isLoading}
      isError={isError}
      data={data}
      lines={lines}
      activeIndex={activeIndex}
      progress={progress}
      isRtl={Boolean(data?.isRightToLeft)}
    />
  );
}

interface LyricsPanelProps {
  trackId: string;
  open: boolean;
  onClose: () => void;
  /**
   * 'overlay' = covers the whole player (mobile-first, used for < md viewports).
   * 'side'    = inline side pane (used inside a flex row on md+).
   */
  mode?: 'overlay' | 'side';
}

export function LyricsPanel({ trackId, open, onClose, mode = 'overlay' }: LyricsPanelProps) {
  const reduce = useReducedMotion();

  if (mode === 'side') {
    // Side pane on md+. Borderless and transparent so it visually merges
    // with the fullscreen player background and doesn't look like a card.
    return (
      <AnimatePresence>
        {open && (
          <motion.aside
            key="lyrics-side"
            initial={reduce ? false : { opacity: 0, x: 32 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 32 }}
            transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
            className="hidden h-full w-full overflow-hidden md:block"
            aria-label="Текст песни"
          >
            <LyricsContent trackId={trackId} />
          </motion.aside>
        )}
      </AnimatePresence>
    );
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="lyrics-overlay"
          initial={reduce ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.22 }}
          // Full-bleed background on mobile (replaces the player surface)
          // with a single dismiss control in the corner so users have a way
          // back to the player without needing to know that the panel is
          // tap-to-close.
          className="absolute inset-0 z-30 flex flex-col bg-background/95 backdrop-blur-xl md:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="Текст песни"
        >
          <div className="relative flex shrink-0 items-center justify-end px-3 pt-3">
            <button
              type="button"
              onClick={onClose}
              aria-label="Закрыть текст"
              className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-border/60 bg-[var(--color-surface-elevated)]/80 text-muted-foreground shadow-[var(--shadow-md)] backdrop-blur transition-colors hover:text-foreground"
            >
              <X size={16} />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-hidden">
            <LyricsContent trackId={trackId} />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

interface LyricsBodyProps {
  isLoading: boolean;
  isError: boolean;
  data: ReturnType<typeof useLyrics>['data'];
  lines: LyricLine[];
  activeIndex: number;
  progress: number;
  isRtl: boolean;
}

const SCROLL_MASK = 'linear-gradient(to bottom, transparent 0%, #000 14%, #000 86%, transparent 100%)';

function LyricsBody({ isLoading, isError, data, lines, activeIndex, progress, isRtl }: LyricsBodyProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const lineRefs = useRef<(HTMLParagraphElement | null)[]>([]);
  const [autoScroll, setAutoScroll] = useState(true);
  const reduce = useReducedMotion();

  useEffect(() => {
    if (!autoScroll) return;
    if (activeIndex < 0) return;
    const el = lineRefs.current[activeIndex];
    if (!el) return;
    el.scrollIntoView({
      behavior: reduce ? 'auto' : 'smooth',
      block: 'center',
    });
  }, [activeIndex, autoScroll, reduce]);

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 size={16} className="animate-spin" />
        Загружаем текст…
      </div>
    );
  }
  if (isError) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
        Не удалось загрузить текст. Попробуйте позже.
      </div>
    );
  }
  if (!data?.available) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
        Для этого трека текст недоступен.
      </div>
    );
  }

  const synced = lines.length > 0;
  const plain = data.lyrics?.split(/\r?\n/).map((l) => l.trim()) ?? [];

  // Pre-roll dots: shown before the very first synced line lands. Track how
  // close we are to that first line so the dots can fill in (Apple Music's
  // "instrumental ●●●" indicator).
  const firstLineTime = synced ? lines[0]?.time ?? 0 : 0;
  const showPreRoll = synced && activeIndex < 0 && firstLineTime > 2;
  const preRollProgress = showPreRoll
    ? Math.max(0, Math.min(1, progress / firstLineTime))
    : 0;

  return (
    <div
      ref={containerRef}
      onWheel={() => setAutoScroll(false)}
      onTouchMove={() => setAutoScroll(false)}
      className="relative h-full overflow-y-auto px-5 py-10 sm:px-8"
      style={{
        WebkitMaskImage: SCROLL_MASK,
        maskImage: SCROLL_MASK,
      }}
      dir={isRtl ? 'rtl' : 'ltr'}
    >
      <div className="mx-auto flex max-w-2xl flex-col gap-5 text-2xl font-bold leading-snug tracking-tight sm:text-[28px] md:text-[26px] lg:text-[30px]">
        {synced ? (
          <>
            {showPreRoll && <PreRollDots progress={preRollProgress} />}
            {lines.map((l, i) => {
              const isActive = i === activeIndex;
              const isPast = i < activeIndex;
              return (
                <motion.p
                  key={i}
                  ref={(el) => { lineRefs.current[i] = el; }}
                  animate={{
                    opacity: isActive ? 1 : isPast ? 0.22 : 0.34,
                    scale: isActive ? 1.04 : 1,
                    filter: isActive ? 'blur(0px)' : 'blur(0.5px)',
                  }}
                  transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
                  className={
                    isActive
                      ? 'origin-left text-foreground drop-shadow-[0_2px_18px_var(--color-accent-soft)]'
                      : 'origin-left text-muted-foreground'
                  }
                >
                  {l.text || '\u00a0'}
                </motion.p>
              );
            })}
          </>
        ) : (
          plain.map((line, i) => (
            <p key={i} className="text-foreground/70">
              {line || '\u00a0'}
            </p>
          ))
        )}
      </div>
      {synced && !autoScroll && (
        <button
          type="button"
          onClick={() => setAutoScroll(true)}
          className="sticky bottom-4 left-1/2 mx-auto block -translate-x-1/2 rounded-full border border-border/60 bg-[var(--color-surface-elevated)]/85 px-4 py-2 text-xs font-medium text-foreground shadow-[0_10px_32px_-6px_rgba(0,0,0,0.55),0_0_24px_-2px_var(--color-accent-soft)] backdrop-blur ring-1 ring-white/10 transition-shadow hover:shadow-[0_12px_36px_-4px_rgba(0,0,0,0.65),0_0_32px_-2px_var(--color-accent-soft)]"
        >
          Прокручивать вместе с песней
        </button>
      )}
    </div>
  );
}

/**
 * Pulsing pre-roll indicator shown between the start of the song and the
 * first lyric line. Three dots that fade in / scale up as we approach the
 * first line, mirroring Apple Music's instrumental hint.
 */
function PreRollDots({ progress }: { progress: number }) {
  const reduce = useReducedMotion();
  return (
    <div className="flex items-center gap-2 py-2" aria-hidden>
      {[0, 1, 2].map((i) => {
        // Dots light up sequentially as progress moves from 0 → 1.
        const threshold = (i + 1) / 4; // 0.25, 0.5, 0.75
        const lit = Math.max(0, Math.min(1, (progress - threshold + 0.25) / 0.25));
        return (
          <motion.span
            key={i}
            className="inline-block h-3 w-3 rounded-full bg-foreground"
            initial={false}
            animate={
              reduce
                ? { opacity: 0.25 + 0.6 * lit, scale: 1 }
                : {
                  opacity: 0.25 + 0.6 * lit,
                  scale: 0.85 + 0.25 * lit,
                }
            }
            transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
          />
        );
      })}
    </div>
  );
}
