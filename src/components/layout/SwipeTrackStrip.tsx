import { useEffect, useRef } from 'react';
import { animate, motion, useMotionValue, useReducedMotion } from 'motion/react';
import { usePlayerStore } from '@/store/player';
import type { Track } from '@/types';

interface SwipeTrackStripProps {
  /**
   * Render function for one track. Receives the track to render and a
   * `position` flag — `'current'` is the visible centre column,
   * `'prev'`/`'next'` are the ghost neighbours peeking through the
   * edge gradients while the user is actively dragging.
   */
  children: (track: Track, position: 'prev' | 'current' | 'next') => React.ReactNode;
  /** Width of one column; defaults to the parent's measured width. */
  className?: string;
  /**
   * Fraction of the column width past which the gesture commits to a
   * navigation. Defaults to 0.28 — feels natural on a 360-pixel
   * mini-player without accidentally firing on small drags.
   */
  threshold?: number;
}

/**
 * Horizontal swipe strip used by the mobile mini-player (П9) and the
 * fullscreen cover (П10). Renders a 3-column filmstrip — previous,
 * current, next — that the user can drag horizontally. Releasing past
 * the threshold animates the strip the rest of the way and triggers
 * `previous()` / `nextManual()`. The neighbours are visually faded via
 * a mask gradient so they look like they're "peeking through" the
 * edges instead of being cropped at hard borders.
 */
export function SwipeTrackStrip({ children, className = '', threshold = 0.28 }: SwipeTrackStripProps) {
  const reduce = useReducedMotion();
  const queue = usePlayerStore((s) => s.queue);
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const previous = usePlayerStore((s) => s.previous);
  const nextManual = usePlayerStore((s) => s.nextManual);

  const containerRef = useRef<HTMLDivElement>(null);
  const x = useMotionValue(0);

  // Reset offset whenever the active track changes — otherwise after a
  // commit the new strip would mount with a stale x and snap back from
  // an unexpected direction.
  useEffect(() => {
    x.set(0);
  }, [currentTrack?.id, x]);

  if (!currentTrack) return null;
  const idx = queue.findIndex((t) => t.id === currentTrack.id);
  const prevTrack = idx > 0 ? queue[idx - 1] : null;
  const nextTrack = idx >= 0 && idx < queue.length - 1 ? queue[idx + 1] : null;

  const commit = (direction: 'prev' | 'next') => {
    const w = containerRef.current?.offsetWidth ?? 320;
    const target = direction === 'prev' ? w : -w;
    animate(x, target, {
      type: 'tween',
      duration: 0.22,
      ease: [0.4, 0, 0.2, 1],
      onComplete: () => {
        // Mini-player swipe is an explicit navigation gesture —
        // force-skip the 3 s rewind threshold so a swipe mid-track
        // always lands on the previous song.
        if (direction === 'prev') previous(true);
        else nextManual();
        // The store update will re-render this component with new
        // current/prev/next; the effect above will reset x to 0.
      },
    });
  };

  return (
    <div ref={containerRef} className={'relative w-full overflow-hidden ' + className}>
      <motion.div
        drag={reduce ? false : 'x'}
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={1}
        dragMomentum={false}
        // `touchAction: pan-y` skips native horizontal scroll inside the
        // strip on mobile. `willChange: transform` promotes the strip to
        // its own compositor layer up-front — the strip lives inside a
        // `liquid-glass` (backdrop-filter) surface, and without a
        // pre-promoted layer mobile WebKit re-rasterizes the glass
        // stack on the first dragged frame, which read as a visible
        // hitch at the start of every swipe.
        //
        // Perf fix (iOS jank): the old edge-fade mask was applied to
        // this whole container via a `dragging` state flipped in
        // `onDragStart` — a mid-gesture React re-render + WebKit mask
        // rasterization exactly on the gesture's first frame. The mask
        // now lives statically on the ghost columns below (the centre
        // column was always fully opaque anyway), so nothing re-renders
        // or re-rasterizes when a drag starts.
        style={{ x, touchAction: 'pan-y', willChange: 'transform' }}
        onDragEnd={(_e, info) => {
          const w = containerRef.current?.offsetWidth ?? 320;
          const dist = info.offset.x;
          const vel = info.velocity.x;
          if ((dist < -w * threshold || vel < -500) && nextTrack) {
            commit('next');
            return;
          }
          if ((dist > w * threshold || vel > 500) && prevTrack) {
            commit('prev');
            return;
          }
          animate(x, 0, { type: 'spring', stiffness: 350, damping: 32 });
        }}
        className="relative flex w-full min-w-0"
      >
        {/* Centre column always renders; neighbours render only when the
            queue actually has a previous / next track to navigate to.
            `min-w-0` on the flex children is critical: without it the
            flex item's intrinsic min-width defaults to `auto` (=
            max-content), which lets a long track title balloon the
            column past the wrapper and push the like/play/next
            buttons off-screen — exactly the bug reported on the
            mobile mini-player. */}
        {/* Ghost columns carry their own static edge-fade mask so they
            melt into transparency toward the strip edge instead of
            being hard-clipped. Static per-ghost masks replace the old
            dynamic container mask (see the comment on the style prop
            above) — visually equivalent while dragging, and the centre
            column stays fully opaque at rest for free. */}
        {prevTrack && (
          <div
            className="pointer-events-none absolute right-full top-0 h-full w-full min-w-0 pr-2"
            style={{
              WebkitMaskImage: 'linear-gradient(to left, black 70%, transparent 100%)',
              maskImage: 'linear-gradient(to left, black 70%, transparent 100%)',
            }}
          >
            {children(prevTrack, 'prev')}
          </div>
        )}
        <div className="w-full min-w-0">
          {children(currentTrack, 'current')}
        </div>
        {nextTrack && (
          <div
            className="pointer-events-none absolute left-full top-0 h-full w-full min-w-0 pl-2"
            style={{
              WebkitMaskImage: 'linear-gradient(to right, black 70%, transparent 100%)',
              maskImage: 'linear-gradient(to right, black 70%, transparent 100%)',
            }}
          >
            {children(nextTrack, 'next')}
          </div>
        )}
      </motion.div>
    </div>
  );
}
