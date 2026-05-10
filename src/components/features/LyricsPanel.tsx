import { useEffect, useMemo, useRef, useState } from 'react';
import { animate, motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { Loader2, X } from 'lucide-react';
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
 * embedded as a side panel on desktop, as a full-screen overlay, or
 * (on narrow viewports) as a direct cover-slot replacement inside the
 * fullscreen player. Exported so callers that already own the surrounding
 * layout can drop it in without the `LyricsPanel` shell.
 */
export function LyricsContent({ trackId, onSeek }: LyricsContentProps) {
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
  onClose: () => void;
  /**
   * 'overlay' = covers the whole player (mobile-first, used for < md viewports).
   * 'side'    = inline side pane (used inside a flex row on md+).
   */
  mode?: 'overlay' | 'side';
  onSeek?: (time: number) => void;
}

export function LyricsPanel({ trackId, open, onClose, mode = 'overlay', onSeek }: LyricsPanelProps) {
  const reduce = useReducedMotion();
  const t = useT();

  if (mode === 'side') {
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

  // Mobile overlay. Slides in from the bottom with a soft spring + a
  // brief blur-in so the underlying player surface visibly recedes
  // before the lyric layer takes over.
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="lyrics-overlay"
          initial={reduce ? false : { opacity: 0, y: 24, scale: 0.98, filter: 'blur(8px)' }}
          animate={reduce ? undefined : { opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' }}
          exit={reduce ? undefined : { opacity: 0, y: 16, scale: 0.985, filter: 'blur(6px)' }}
          transition={{
            opacity: { duration: 0.28, ease: [0.16, 1, 0.3, 1] },
            filter: { duration: 0.28, ease: [0.16, 1, 0.3, 1] },
            y: { type: 'spring', stiffness: 280, damping: 30, mass: 0.85 },
            scale: { type: 'spring', stiffness: 280, damping: 26 },
          }}
          style={{ transformOrigin: 'center bottom' }}
          className="absolute inset-0 z-30 flex flex-col bg-background/95 backdrop-blur-xl md:hidden"
          role="dialog"
          aria-modal="true"
          aria-label={t('lyrics.title')}
        >
          {/*
           * `paddingTop` keeps the original 0.75rem rhythm but mixes
           * in the PWA notch / status-bar inset so the close (X)
           * button isn't covered by the iPhone notch / Dynamic Island
           * when the app runs as an installed PWA. The variable
           * resolves to `0px` in regular browser tabs and inside
           * Telegram WebApp (display-mode: browser) so the on-screen
           * position is byte-for-byte identical there. See
           * `globals.scss` for the `--pwa-safe-top` definition.
           */}
          <motion.div
            className="relative flex shrink-0 items-center justify-end px-3"
            style={{
              paddingTop: 'calc(0.75rem + var(--pwa-safe-top))',
            }}
            initial={reduce ? false : { opacity: 0, y: -8 }}
            animate={reduce ? undefined : { opacity: 1, y: 0 }}
            transition={{ duration: 0.22, delay: 0.08, ease: [0.16, 1, 0.3, 1] }}
          >
            <button
              type="button"
              onClick={onClose}
              aria-label={t('lyrics.closeAria')}
              className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-border/60 bg-[var(--color-surface-elevated)]/80 text-muted-foreground shadow-[var(--shadow-md)] backdrop-blur transition-colors hover:text-foreground"
            >
              <X size={16} />
            </button>
          </motion.div>
          <div className="min-h-0 flex-1 overflow-hidden">
            <LyricsContent trackId={trackId} onSeek={onSeek} />
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

  // Status-state shells: loading / error / empty. We size them
  // `h-full w-full` because the cover-slot wrapper around
  // `LyricsContent` uses `display: flex` (row) with default
  // `align-items: stretch`. Without `w-full` the child only
  // takes content-width, which makes `justify-center` collapse to
  // "centred inside the loader's own intrinsic width" — visually
  // the spinner + label sit at the LEFT of the panel. Adding
  // `w-full` lets the flex-row child fill the slot's width so the
  // inner `justify-center` actually centres horizontally. The
  // same fix applies to error / empty states.
  if (isLoading) {
    return (
      <div className="flex h-full w-full items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 size={16} className="animate-spin" />
        {t('lyrics.loading')}
      </div>
    );
  }
  if (isError) {
    return (
      <div className="flex h-full w-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
        {t('lyrics.error')}
      </div>
    );
  }
  if (!data?.available) {
    return (
      <div className="flex h-full w-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
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
      // `no-scrollbar` (defined in globals.scss) hides the
      // WebKit + Firefox scrollbars while preserving overflow
      // behaviour. The lyrics layer leans heavily on the SCROLL_MASK
      // fade for visual rhythm — a real bar at the side breaks the
      // song-sheet aesthetic, doubly so on the narrow cover-slot
      // variant on mobile where the panel is only ~28rem wide.
      className="no-scrollbar relative h-full overflow-y-auto px-5 py-10 sm:px-8"
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
                    // Blur on inactive lines was a half-pixel
                    // (0.5px) — DevTools rounds it to 0 so on PC
                    // the effect was invisible, but real-device
                    // DPR ≥ 2 (every modern phone) renders the
                    // half-pixel as a visible smear that flickers
                    // off-and-on as each new line activates. The
                    // user reported this exact pattern: "очень
                    // слабый блюр… пропадает когда строчка
                    // переключается и потом опять накладывается".
                    // Removing the filter entirely keeps opacity +
                    // scale as the only depth cues, which is what
                    // the desktop view always actually showed.
                    filter: 'blur(0px)',
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
        // Sticky wrapper sits at the bottom of the lyrics scroll
        // container; the inner button is `inline-flex` so its width
        // is content-sized, then horizontally centred inside the
        // wrapper via `justify-center`. Previously the button used
        // `block + left-1/2 + -translate-x-1/2` which on `block`
        // made the button stretch full-width and read as left-aligned
        // text — visibly NOT centred relative to the lyrics panel.
        // The wrapper is `pointer-events-none` so the empty space
        // around the button still passes wheel / touch events
        // through to the verse list below; the button itself
        // re-enables pointer events on `pointer-events-auto`.
        <div className="sticky bottom-4 z-10 flex justify-center pointer-events-none">
          <button
            type="button"
            onClick={() => setAutoScroll(true)}
            // `liquid-glass` is the same surface recipe the navbar
            // / mobile dock / popovers use — multi-layer box-shadow
            // chrome bezel + backdrop-filter blur. It paints the
            // chrome itself; we just add the rounded-full pill,
            // padding, typography and a soft accent halo so the
            // button reads as part of the same family as the
            // navbar/dock surfaces but with a distinguishing
            // purple glow.
            className="liquid-glass pointer-events-auto rounded-full px-4 py-2 text-xs font-medium text-foreground shadow-[0_0_24px_-2px_var(--color-accent-soft)] transition-shadow hover:shadow-[0_0_32px_-2px_var(--color-accent-soft)]"
          >
            {t('lyrics.followAlong')}
          </button>
        </div>
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
