import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';

interface MarqueeProps {
  /** Text to display. If it overflows the container, a slow slide animation
   *  reveals the hidden tail every `pause` ms. We accept a string (not
   *  ReactNode) because we measure `scrollWidth` against `clientWidth`
   *  to decide whether to animate, and that needs a stable single child
   *  with predictable layout. */
  text: string;
  className?: string;
  /** Idle pause at each end before sliding, in ms. */
  pause?: number;
  /** Slide speed in pixels per second. */
  speed?: number;
  /** Width of the soft fade on each edge (px). The container gets a
   *  CSS mask so the text dissolves into the player background instead
   *  of being chopped at the container edge. */
  fade?: number;
  /** Optional `aria-label` override (defaults to the text). */
  'aria-label'?: string;
}

/** Single-line text that auto-truncates when it fits and gently slides
 *  to reveal its tail when it doesn't. The two ends are softly masked
 *  so the text fades in/out of the container edges instead of getting
 *  visually chopped — same pattern used by Spotify, Apple Music, etc.
 *
 *  We re-measure on:
 *  - container size changes (window resize, sidebar toggle)
 *  - content size changes (different track)
 *  via a `ResizeObserver` on both the wrapper and the inner span.
 */
export function Marquee({
  text,
  className = '',
  pause = 3500,
  speed = 32,
  fade = 14,
  'aria-label': ariaLabel,
}: MarqueeProps) {
  const wrapperRef = useRef<HTMLSpanElement | null>(null);
  const innerRef = useRef<HTMLSpanElement | null>(null);
  const [overflow, setOverflow] = useState(0);
  const reduce = useReducedMotion();

  useLayoutEffect(() => {
    const wrapper = wrapperRef.current;
    const inner = innerRef.current;
    if (!wrapper || !inner) return;
    const measure = () => {
      const diff = inner.scrollWidth - wrapper.clientWidth;
      // Tolerance to avoid jitter on subpixel reflow.
      setOverflow(diff > 4 ? Math.ceil(diff) : 0);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(wrapper);
    ro.observe(inner);
    return () => ro.disconnect();
  }, [text]);

  // Re-trigger measure after fonts load (text width changes once the
  // custom font swaps in from fallback).
  useEffect(() => {
    const fonts = (document as Document & { fonts?: { ready: Promise<unknown> } }).fonts;
    if (!fonts?.ready) return;
    let cancelled = false;
    fonts.ready.then(() => {
      if (cancelled) return;
      const wrapper = wrapperRef.current;
      const inner = innerRef.current;
      if (!wrapper || !inner) return;
      const diff = inner.scrollWidth - wrapper.clientWidth;
      setOverflow(diff > 4 ? Math.ceil(diff) : 0);
    });
    return () => { cancelled = true; };
  }, [text]);

  const distance = overflow > 0 ? overflow + 8 : 0;
  const slideTime = distance / speed; // seconds
  const total = (pause * 2) / 1000 + slideTime * 2;
  const t1 = (pause / 1000) / total;
  const t2 = ((pause / 1000) + slideTime) / total;
  const t3 = ((pause * 2) / 1000 + slideTime) / total;

  const shouldAnimate = distance > 0 && !reduce;
  const maskStyle: React.CSSProperties = distance > 0
    ? {
        WebkitMaskImage: `linear-gradient(to right, transparent 0, black ${fade}px, black calc(100% - ${fade}px), transparent 100%)`,
        maskImage: `linear-gradient(to right, transparent 0, black ${fade}px, black calc(100% - ${fade}px), transparent 100%)`,
      }
    : {};

  return (
    <span
      ref={wrapperRef}
      className={'block w-full whitespace-nowrap ' + className}
      aria-label={ariaLabel ?? text}
      style={{
        // CSS spec forces `overflow-x: hidden` to also clip y — we want
        // y unbounded so `text-shadow` (and the soft halation we apply
        // on fullscreen-player descendants) can extend above and below
        // the text line without being chopped at the box.
        // `clip-path: inset(...)` gives us per-axis control: clip x to
        // the wrapper's box but leave a generous vertical bleed so the
        // shadow has room. The negative top/bottom inset is a fixed
        // px so the layout doesn't depend on the wrapper's font-size.
        clipPath: 'inset(-1.5em 0 -1.5em 0)',
        WebkitClipPath: 'inset(-1.5em 0 -1.5em 0)',
        ...maskStyle,
      }}
    >
      <motion.span
        ref={innerRef}
        className="inline-block whitespace-nowrap will-change-transform"
        animate={shouldAnimate ? { x: [0, 0, -distance, -distance, 0] } : { x: 0 }}
        transition={shouldAnimate ? {
          duration: total,
          times: [0, t1, t2, t3, 1],
          ease: 'easeInOut',
          repeat: Infinity,
        } : { duration: 0 }}
      >
        {text}
      </motion.span>
    </span>
  );
}
