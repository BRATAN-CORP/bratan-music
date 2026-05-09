import { useEffect, useMemo, useRef, useState } from 'react';
import { animate, motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { Loader2 } from 'lucide-react';
import { useLyrics, parseLrc, type LyricLine } from '@/hooks/useLyrics';
import { usePlayerStore } from '@/store/player';
import { useT } from '@/i18n';

interface LyricsContentProps {
  trackId: string;
  onSeek?: (time: number) => void;
}

/**
 * Inner lyrics view — fetches, parses and renders the (possibly synced)
 * lyrics in Apple-Music style. Has no positioning of its own so it can be
 * embedded as a side panel on desktop or as a full-screen overlay on mobile.
 */
function LyricsContent({ trackId, onSeek }: LyricsContentProps) {
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
      const lineTime = lines[mid]?.time ?? Infinity;
      if (lineTime <= progress) {
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
      onSeek={onSeek}
    />
  );
}

interface LyricsPanelProps {
  trackId: string;
  open: boolean;
  /** Reserved for future modes (the 'overlay' mode used to call this
   *  to dismiss; modern modes are dismissed by the parent's own
   *  toggle in the player chrome). */
  onClose?: () => void;
  /**
   * 'side'  = inline side pane on md+ (`hidden md:block`). Slides in
   *           from the right next to the cover.
   * 'cover' = inline mobile pane (`md:hidden`) rendered IN PLACE of
   *           the cover artwork on narrow viewports. Same content +
   *           same typography as the desktop side panel — the user
   *           explicitly asked for parity. Sized by its parent (the
   *           cover column in `FullscreenPlayer`) and animated with a
   *           short blur-in / scale-up so the swap from cover to
   *           lyrics reads as a tactile transition.
   */
  mode?: 'side' | 'cover';
  onSeek?: (time: number) => void;
}

export function LyricsPanel({ trackId, open, mode = 'side', onSeek }: LyricsPanelProps) {
  const reduce = useReducedMotion();
  const t = useT();

  if (mode === 'cover') {
    // Mobile inline pane. Sits where the cover artwork was —
    // `FullscreenPlayer` hides the cover wrapper entirely while
    // `lyricsOpen` is true on `< md`, and renders this in its place.
    // The animation is intentionally a short blur+scale rather than
    // a slide-in so the swap looks like the cover dissolved into
    // text rather than a drawer landing on top of it.
    return (
      <AnimatePresence>
        {open && (
          <motion.aside
            key="lyrics-cover"
            initial={reduce ? false : { opacity: 0, scale: 0.985, filter: 'blur(8px)' }}
            animate={reduce ? undefined : { opacity: 1, scale: 1, filter: 'blur(0px)' }}
            exit={reduce ? undefined : { opacity: 0, scale: 0.985, filter: 'blur(6px)' }}
            transition={{
              opacity: { duration: 0.28, ease: [0.16, 1, 0.3, 1] },
              filter: { duration: 0.28, ease: [0.16, 1, 0.3, 1] },
              scale: { type: 'spring', stiffness: 260, damping: 26 },
            }}
            style={{ transformOrigin: 'center center' }}
            className="block h-full w-full overflow-hidden md:hidden"
            aria-label={t('lyrics.title')}
          >
            <LyricsContent trackId={trackId} onSeek={onSeek} />
          </motion.aside>
        )}
      </AnimatePresence>
    );
  }

  // Side pane on md+. Borderless and transparent so it visually merges
  // with the fullscreen player background. The panel slides in from
  // the right with a soft spring + a subtle scale so it lands instead
  // of just sliding — same feel modals get when they animate in.
  return (
    <AnimatePresence>
      {open && (
        <motion.aside
          key="lyrics-side"
          initial={reduce ? false : { opacity: 0, x: 48, scale: 0.985, filter: 'blur(6px)' }}
          animate={reduce ? undefined : { opacity: 1, x: 0, scale: 1, filter: 'blur(0px)' }}
          exit={reduce ? undefined : { opacity: 0, x: 32, scale: 0.985, filter: 'blur(4px)' }}
          transition={{
            opacity: { duration: 0.32, ease: [0.16, 1, 0.3, 1] },
            filter: { duration: 0.32, ease: [0.16, 1, 0.3, 1] },
            x: { type: 'spring', stiffness: 240, damping: 32, mass: 0.9 },
            scale: { type: 'spring', stiffness: 260, damping: 26 },
          }}
          style={{ transformOrigin: 'right center' }}
          className="hidden h-full w-full overflow-hidden md:block"
          aria-label={t('lyrics.title')}
        >
          <LyricsContent trackId={trackId} onSeek={onSeek} />
        </motion.aside>
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
  onSeek?: (time: number) => void;
}

const SCROLL_MASK = 'linear-gradient(to bottom, transparent 0%, #000 14%, #000 86%, transparent 100%)';

function LyricsBody({ isLoading, isError, data, lines, activeIndex, progress, isRtl, onSeek }: LyricsBodyProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const lineRefs = useRef<(HTMLParagraphElement | null)[]>([]);
  const [autoScroll, setAutoScroll] = useState(true);
  const reduce = useReducedMotion();
  const t = useT();

  useEffect(() => {
    if (!autoScroll) return;
    if (activeIndex < 0) return;
    const el = lineRefs.current[activeIndex];
    const container = containerRef.current;
    if (!el || !container) return;
    // Manual scroll on the lyrics container only — `el.scrollIntoView` walks
    // up every scrollable ancestor and on mobile browsers ends up scrolling
    // the page (or the fullscreen player root) too, which makes the whole
    // fullscreen overlay shift up and exposes the mini-player below it.
    const target = Math.max(
      0,
      el.offsetTop - container.clientHeight / 2 + el.offsetHeight / 2,
    );
    if (reduce) {
      container.scrollTop = target;
      return;
    }
    // Drive `scrollTop` with motion's spring animator instead of the
    // browser's `behavior: 'smooth'`. The native smooth-scroll has
    // wildly different easing/duration across browsers (especially
    // mobile Safari, where it visibly stutters when a new active
    // line lands while a previous scroll is still resolving). A
    // soft spring lets each new target hand off cleanly to the
    // next without the previous tween "fighting" it.
    const controls = animate(container.scrollTop, target, {
      type: 'spring',
      stiffness: 70,
      damping: 24,
      mass: 0.9,
      onUpdate: (v) => {
        container.scrollTop = v;
      },
    });
    return () => controls.stop();
  }, [activeIndex, autoScroll, reduce]);

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 size={16} className="animate-spin" />
        {t('lyrics.loading')}
      </div>
    );
  }
  if (isError) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
        {t('lyrics.error')}
      </div>
    );
  }
  if (!data?.available) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
        {t('lyrics.empty')}
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
      // `data-allow-pan-y` opts back into native vertical scrolling
      // inside the fullscreen-drag-zone (which globally pins
      // `touch-action: none` on every descendant so the swipe-down
      // dismiss works on every empty pixel of the player). Without
      // this attribute the lyrics scroller would inherit `none` and
      // the user couldn't manually scroll through verses on touch.
      data-allow-pan-y
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
                  // Spring-based handoff so consecutive line changes
                  // don't visibly "step" — the previous tween's easing
                  // tail blends into the next instead of cutting it
                  // off mid-curve. `opacity`/`filter` use a short
                  // ease tween (springs on opacity/filter look mushy
                  // because their start/end values are so close that
                  // any overshoot reads as wobble).
                  transition={{
                    scale: { type: 'spring', stiffness: 130, damping: 22, mass: 0.9 },
                    opacity: { duration: 0.55, ease: [0.16, 1, 0.3, 1] },
                    filter: { duration: 0.55, ease: [0.16, 1, 0.3, 1] },
                  }}
                  onClick={() => {
                    if (onSeek && l.time != null) {
                      onSeek(l.time);
                      setAutoScroll(true);
                    }
                  }}
                  // We deliberately do NOT add `transition-transform` /
                  // `active:scale-[0.98]` here. Those Tailwind classes
                  // emit a CSS `transition: transform 150ms` + a
                  // `:active`-only `transform: scale(0.98)`, which
                  // fight with motion's spring-driven `scale` (motion
                  // writes the inline `transform` every frame; the
                  // browser's CSS transition tries to interpolate
                  // between consecutive inline writes too, and on the
                  // line that just deactivated this manifests as a
                  // brief "scale flicker" that snaps back — exactly
                  // the artefact the user reported. Letting motion
                  // own the transform fully eliminates the conflict.
                  className={
                    (isActive
                      ? 'origin-left text-foreground drop-shadow-[0_2px_18px_var(--color-accent-soft)]'
                      : 'origin-left text-muted-foreground')
                    + (onSeek ? ' cursor-pointer select-none' : '')
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
          {t('lyrics.followAlong')}
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
