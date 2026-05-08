import { useEffect, useRef, useState } from 'react';
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
  // Tracks whether the user is actively dragging the strip. We use
  // this to gate the symmetric edge-fade mask: at rest the cover and
  // its left edge should be fully opaque (no phantom darkening eating
  // into the cover artwork). The mask should only fade in once the
  // user starts a horizontal swipe so neighbour-track ghosts can
  // peek through. `dragging` stays true through the post-release
  // settle animation and is cleared on completion below.
  const [dragging, setDragging] = useState(false);

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
        // current/prev/next; the effect above will reset x to 0 and
        // clears the drag mask.
        setDragging(false);
      },
    });
  };

  return (
    <div
      ref={containerRef}
      className={'relative w-full overflow-hidden ' + className}
      style={
        // Symmetric edge mask so neighbour ghosts fade into transparency
        // instead of being hard-clipped at the container border. Only
        // applied while the user is actively dragging — at rest the
        // cover/title row should be fully opaque without a phantom
        // dark band on the left edge eating into the artwork.
        dragging
          ? {
              WebkitMaskImage:
                'linear-gradient(to right, transparent 0%, black 8%, black 92%, transparent 100%)',
              maskImage:
                'linear-gradient(to right, transparent 0%, black 8%, black 92%, transparent 100%)',
            }
          : undefined
      }
    >
      <motion.div
        drag={reduce ? false : 'x'}
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={1}
        dragMomentum={false}
        // Skip native horizontal scroll inside the strip on mobile.
        style={{ x, touchAction: 'pan-y' }}
        onDragStart={() => setDragging(true)}
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
          animate(x, 0, {
            type: 'spring',
            stiffness: 350,
            damping: 32,
            onComplete: () => setDragging(false),
          });
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
        {prevTrack && (
          <div className="pointer-events-none absolute right-full top-0 h-full w-full min-w-0 pr-2">
            {children(prevTrack, 'prev')}
          </div>
        )}
        <div className="w-full min-w-0">
          {children(currentTrack, 'current')}
        </div>
        {nextTrack && (
          <div className="pointer-events-none absolute left-full top-0 h-full w-full min-w-0 pl-2">
            {children(nextTrack, 'next')}
          </div>
        )}
      </motion.div>
    </div>
  );
}
