import { motion, useMotionValue, useSpring, useTransform, useReducedMotion } from 'motion/react';
import { type CSSProperties, type PointerEvent, type ReactNode, useRef } from 'react';
import { cn } from '@/lib/utils';

/**
 * Firefox refuses to deliver pointerup / click events to descendants
 * of an element that owns `transform-style: preserve-3d` +
 * `perspective` while `rotateX/rotateY` are non-zero — even after
 * we synchronously reset the transform on pointerdown via
 * `.tilt-flatten`. The hit-test geometry stays cached on the
 * compositor layer for the rest of the gesture, so the buttons
 * inside the wave hero / fullscreen cover are reachable on hover
 * but never receive their `click`. Reproduces in current Firefox
 * stable / ESR, no upstream fix on the tracker.
 *
 * Chromium and WebKit both honour `tilt-flatten` instantly, so we
 * keep the tilt animation on those engines and skip it on Firefox.
 * Detection is done with `CSS.supports('-moz-appearance: none')`
 * because UA sniffing matches Firefox forks (LibreWolf, Tor
 * Browser, Mullvad, Waterfox) too — those forks share the same
 * Gecko hit-test bug, so they should fall through the same path.
 *
 * SSR-safe: `typeof CSS === 'undefined'` covers the build-time and
 * Node test paths, in which case we default to the 3D-tilt
 * behaviour (the static markup is rendered identically either way).
 */
function isFirefoxLike(): boolean {
  if (typeof CSS === 'undefined' || !CSS.supports) return false;
  try {
    return CSS.supports('-moz-appearance', 'none');
  } catch {
    return false;
  }
}

interface TiltCardProps {
  children: ReactNode;
  className?: string;
  /** Tilt range in degrees on either axis. */
  intensity?: number;
  /** Show a moving radial highlight that follows the cursor. */
  glare?: boolean;
  /** Scale applied while the pointer is over the card. */
  hoverScale?: number;
  /** Glare strength (0..1). Higher = more visible highlight. */
  glareStrength?: number;
  /** Extra inline style merged onto the outer wrapper. The component
   *  owns `rotateX`, `rotateY`, `scale`, `z`, `transformStyle`, and
   *  `perspective` itself — those win on conflict. Useful to add a
   *  `clip-path` for ancestor 3D-transform clipping edge cases. */
  style?: CSSProperties;
}

export function TiltCard({
  children,
  className,
  intensity = 14,
  glare = true,
  hoverScale = 1.03,
  glareStrength = 0.55,
  style: extraStyle,
}: TiltCardProps) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const hover = useMotionValue(0);
  const sx = useSpring(x, { stiffness: 240, damping: 20 });
  const sy = useSpring(y, { stiffness: 240, damping: 20 });
  const sHover = useSpring(hover, { stiffness: 220, damping: 22 });

  const rotateX = useTransform(sy, [-0.5, 0.5], [intensity, -intensity]);
  const rotateY = useTransform(sx, [-0.5, 0.5], [-intensity, intensity]);
  const scale = useTransform(sHover, [0, 1], [1, hoverScale]);
  const z = useTransform(sHover, [0, 1], [0, 30]);

  const glareX = useTransform(sx, [-0.5, 0.5], ['0%', '100%']);
  const glareY = useTransform(sy, [-0.5, 0.5], ['0%', '100%']);
  const glareOpacity = useTransform(sHover, [0, 1], [0, 1]);
  const glareBg = useTransform(
    [glareX, glareY] as unknown as never,
    ([gx, gy]: [string, string]) =>
      `radial-gradient(circle at ${gx} ${gy}, rgba(255,255,255,${glareStrength}) 0%, rgba(255,255,255,${glareStrength * 0.4}) 25%, transparent 60%)`,
  );

  // Freeze + flatten tilt while the pointer is pressed on an
  // interactive descendant. Without this, CSS 3D rotation moves the
  // children by a few pixels between mousedown and mouseup at any
  // non-zero intensity, and the browser hit-tests pointerup against
  // whatever element the cursor is over at release time → the click
  // misses on fast taps.
  //
  // We mutate the DOM transform synchronously ourselves, *before* the
  // browser's pointerup hit-test. We do that by adding a
  // `.tilt-flatten` class with `transform: none !important` (defined
  // in globals.scss). A class with !important beats motion's inline
  // `style.transform = ...` (which is written without priority), and
  // `classList.add` updates the computed style synchronously — the
  // very next mouseup / click hit-test uses the un-rotated rect.
  //
  // (We can't just `jump()` the springs to 0 on press: that fixes the
  //  spring's logical value synchronously, but motion-dom batches its
  //  actual DOM writes via rAF — for fast clicks the next frame
  //  hasn't rendered when pointerup fires, so the hit-test still runs
  //  against the rotated rect.)
  //
  // For non-interactive presses (e.g. user drags from the empty card
  // background) we just freeze the spring target without flattening —
  // the card stays tilted and gives a more tactile press feel.
  const pressed = useRef(false);
  const interactiveSelector =
    'button, a, input, textarea, select, label, [role="button"], [role="link"], [role="menuitem"], [role="tab"], [role="checkbox"], [role="switch"], [data-tilt-snap]';

  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    if (reduce || !ref.current || pressed.current) return;
    const rect = ref.current.getBoundingClientRect();
    x.set((e.clientX - rect.left) / rect.width - 0.5);
    y.set((e.clientY - rect.top) / rect.height - 0.5);
  };

  const onEnter = () => {
    if (reduce) return;
    hover.set(1);
  };

  const onLeave = () => {
    x.set(0);
    y.set(0);
    hover.set(0);
    pressed.current = false;
    ref.current?.classList.remove('tilt-flatten');
  };

  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    pressed.current = true;
    const target = e.target as Element | null;
    if (target?.closest(interactiveSelector)) {
      // Synchronous DOM-level flatten — wins over motion's inline
      // transform via !important, so the next pointerup hit-test
      // uses an un-rotated rect and the click lands.
      ref.current?.classList.add('tilt-flatten');
      // Also reset the spring logical state so when the press ends
      // and the class comes off, motion picks back up from neutral
      // instead of snapping to whatever rotated value it had cached.
      x.set(0);
      y.set(0);
      sx.jump(0);
      sy.jump(0);
    }
  };
  const onUp = () => {
    pressed.current = false;
    ref.current?.classList.remove('tilt-flatten');
  };

  if (reduce || isFirefoxLike()) {
    // Static fallback for users with `prefers-reduced-motion: reduce`
    // and for Firefox / Gecko forks (see comment on `isFirefoxLike`
    // above). We render the same outer markup with the same
    // `className` so layout / borders / shadows / clipping match the
    // 3D path exactly — only the rotation/scale/glare animation is
    // skipped. That keeps the card visually indistinguishable when
    // it's at rest (which is the dominant state) and restores click
    // delivery to descendants like the wave hero buttons.
    return (
      <div ref={ref} className={cn('relative', className)} style={extraStyle}>
        <div className="relative h-full w-full">{children}</div>
      </div>
    );
  }

  return (
    <motion.div
      ref={ref}
      onPointerMove={onMove}
      onPointerEnter={onEnter}
      onPointerLeave={onLeave}
      onPointerDown={onDown}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      style={{ ...extraStyle, rotateX, rotateY, scale, z, transformStyle: 'preserve-3d', perspective: 1100 }}
      className={cn('relative will-change-transform', className)}
    >
      {/* Fill the outer transform wrapper so children laid out with
          `h-full` / `absolute inset-0` resolve correctly. Without
          explicit dimensions this static div is `auto`-sized and
          percentage heights on children collapsed to zero — which is
          what made the fullscreen cover disappear. */}
      <div className="relative h-full w-full" style={{ transformStyle: 'preserve-3d' }}>{children}</div>
      {glare && (
        <motion.div
          aria-hidden
          className="pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit] mix-blend-overlay"
          style={{ background: glareBg, opacity: glareOpacity }}
        />
      )}
    </motion.div>
  );
}
