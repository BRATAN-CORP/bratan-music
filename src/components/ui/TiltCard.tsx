import { motion, useMotionValue, useSpring, useTransform, useReducedMotion } from 'motion/react';
import { type CSSProperties, type PointerEvent, type ReactNode, useRef } from 'react';
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
      <div ref={ref} className={cn('relative', className)} style={extraStyle}>
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
