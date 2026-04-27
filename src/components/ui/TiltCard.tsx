import { motion, useMotionValue, useSpring, useTransform, useReducedMotion } from 'motion/react';
import { type PointerEvent, type ReactNode, useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';

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
  /** When true, also drive the tilt from `DeviceOrientationEvent` so
   *  tilting the phone gently rotates the card. Falls back silently
   *  if the device has no orientation sensors or the user denies the
   *  permission prompt (iOS 13+). The pointer-based tilt still works
   *  in parallel for desktop or stylus users. */
  useGyroscope?: boolean;
}

export function TiltCard({
  children,
  className,
  intensity = 14,
  glare = true,
  hoverScale = 1.03,
  glareStrength = 0.55,
  useGyroscope = false,
}: TiltCardProps) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const hover = useMotionValue(0);

  // Gyroscope-driven tilt for mobile. We map device orientation to the
  // same -0.5..0.5 range used by pointer input so the existing
  // useSpring/useTransform pipeline downstream needs no changes.
  //
  // Calibration:
  //  - beta is front/back tilt in degrees, -180..180. Most users
  //    naturally hold the phone at ~30° forward; we treat that as
  //    neutral and map +/-30° around it to the full +/-0.5 range.
  //  - gamma is left/right tilt, -90..90. We map +/-25° to +/-0.5
  //    so a small wrist roll already produces visible tilt without
  //    walking the card off-screen at extreme angles.
  useEffect(() => {
    if (!useGyroscope || reduce) return;
    // Skip on devices that don't have a touch-first input mode —
    // desktops and laptops don't have a meaningful gyro reading.
    if (typeof window === 'undefined') return;
    const coarse = window.matchMedia?.('(pointer: coarse)')?.matches;
    if (!coarse) return;

    let active = true;
    let cleanup: (() => void) | null = null;

    const startListening = () => {
      if (!active) return;
      const handler = (e: DeviceOrientationEvent) => {
        const beta = e.beta ?? 0;     // front/back, degrees
        const gamma = e.gamma ?? 0;   // left/right, degrees
        const yVal = Math.max(-0.5, Math.min(0.5, (beta - 30) / 60));
        const xVal = Math.max(-0.5, Math.min(0.5, gamma / 50));
        x.set(xVal);
        y.set(yVal);
        // Hover engages the scale + glare lift; we keep the value
        // partial (0.6) so the gyro effect is gentler than a real
        // pointer hover, and the glare doesn't strobe on every wrist
        // movement.
        hover.set(0.6);
      };
      window.addEventListener('deviceorientation', handler);
      cleanup = () => window.removeEventListener('deviceorientation', handler);
    };

    type DOEWithPermission = typeof DeviceOrientationEvent & {
      requestPermission?: () => Promise<'granted' | 'denied'>;
    };
    const DOE = DeviceOrientationEvent as DOEWithPermission;
    if (typeof DOE.requestPermission === 'function') {
      // iOS 13+ — needs a user-gesture call. The fullscreen player
      // mounts as a direct response to a tap, so we're still inside
      // the gesture window when this runs.
      DOE.requestPermission()
        .then((state) => {
          if (state === 'granted') startListening();
        })
        .catch(() => { /* user denied or browser blocked — ignore */ });
    } else {
      startListening();
    }

    return () => {
      active = false;
      cleanup?.();
      x.set(0);
      y.set(0);
      hover.set(0);
    };
  }, [useGyroscope, reduce, x, y, hover]);
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

  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    if (reduce || !ref.current) return;
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
  };

  if (reduce) {
    return (
      <div ref={ref} className={cn('relative', className)}>
        {children}
      </div>
    );
  }

  return (
    <motion.div
      ref={ref}
      onPointerMove={onMove}
      onPointerEnter={onEnter}
      onPointerLeave={onLeave}
      style={{ rotateX, rotateY, scale, z, transformStyle: 'preserve-3d', perspective: 1100 }}
      className={cn('relative will-change-transform', className)}
    >
      <div style={{ transformStyle: 'preserve-3d' }}>{children}</div>
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
