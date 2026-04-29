import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { animate, motion, useMotionValue, useMotionValueEvent, useReducedMotion } from 'motion/react';

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
   *  of being chopped at the container edge. The two edges are masked
   *  asymmetrically — see below. */
  fade?: number;
  /** Optional `aria-label` override (defaults to the text). */
  'aria-label'?: string;
}

/** Single-line text that auto-truncates when it fits and gently slides
 *  to reveal its tail when it doesn't.
 *
 *  Mask behaviour:
 *  - At rest, only the side that actually has hidden content is faded.
 *    Short text that fits the box is rendered with no mask at all so
 *    the surrounding `text-shadow` halation can extend freely past the
 *    box (a flex-1 column inside a `text-center` row would otherwise
 *    chop the shadow at the column edge — the bug the user reported).
 *  - While the text slides, both fades smoothly grow/shrink in lockstep
 *    with how much content is currently hidden on each side. The left
 *    fade only appears once the text has actually moved off the left
 *    edge, so a stationary marquee never has its leading edge "eaten"
 *    by a phantom shadow mask.
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

  // Drive the slide ourselves so we can read the current x and update
  // the asymmetric mask in lockstep with the animation. (motion's
  // declarative `animate={{ x: [...] }}` would also work but we'd lose
  // the live read-back without an additional ref dance.)
  const x = useMotionValue(0);

  useEffect(() => {
    if (!shouldAnimate) {
      x.set(0);
      return;
    }
    const controls = animate(x, [0, 0, -distance, -distance, 0], {
      duration: total,
      times: [0, t1, t2, t3, 1],
      ease: 'easeInOut',
      repeat: Infinity,
    });
    return () => controls.stop();
  }, [shouldAnimate, distance, total, t1, t2, t3, x]);

  // Compute the per-side fade widths from the live `x` value. We
  // intentionally write to inline CSS variables instead of re-rendering
  // — `useMotionValueEvent` fires every animation frame and React
  // re-renders are far too slow for that.
  const writeFade = (v: number) => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    if (distance <= 0) {
      wrapper.style.setProperty('--marquee-fade-l', '0px');
      wrapper.style.setProperty('--marquee-fade-r', '0px');
      return;
    }
    // hidden_left = -x (clamped 0..distance)
    // hidden_right = distance + x (clamped 0..distance)
    const hiddenLeft = Math.max(0, -v);
    const hiddenRight = Math.max(0, distance + v);
    // Ramp each fade in over the first `fade` px of hidden content
    // so the mask gracefully fades up rather than snapping on at the
    // first subpixel of motion.
    const ramp = Math.max(1, fade);
    const leftFade = Math.round(fade * Math.min(1, hiddenLeft / ramp));
    const rightFade = Math.round(fade * Math.min(1, hiddenRight / ramp));
    wrapper.style.setProperty('--marquee-fade-l', `${leftFade}px`);
    wrapper.style.setProperty('--marquee-fade-r', `${rightFade}px`);
  };

  useMotionValueEvent(x, 'change', writeFade);

  // Seed the CSS variables synchronously so the very first paint
  // already has the correct asymmetric mask (no flash of full-fade).
  useLayoutEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    if (distance <= 0) {
      wrapper.style.setProperty('--marquee-fade-l', '0px');
      wrapper.style.setProperty('--marquee-fade-r', '0px');
    } else {
      // At rest the text sits at x=0: nothing hidden on the left,
      // `distance` px hidden on the right.
      wrapper.style.setProperty('--marquee-fade-l', '0px');
      wrapper.style.setProperty('--marquee-fade-r', `${fade}px`);
    }
  }, [distance, fade]);

  const isMarqueeing = distance > 0;
  const maskImage = isMarqueeing
    ? 'linear-gradient(to right, transparent 0, black var(--marquee-fade-l), black calc(100% - var(--marquee-fade-r)), transparent 100%)'
    : undefined;

  return (
    <span
      ref={wrapperRef}
      className={'relative block w-full max-w-full min-w-0 whitespace-nowrap ' + className}
      aria-label={ariaLabel ?? text}
      style={{
        // Horizontal-only clipping. We need the box to never report a
        // content width larger than its container (PR #120 — a long
        // inline-block child's intrinsic max-content was leaking into
        // the parent flex's sizing on iOS Safari, pushing siblings off
        // screen). But plain `overflow: hidden` clips vertically too
        // and was eating Cyrillic ascenders / descenders ('у', 'д',
        // 'й') in the fullscreen player title — the user reported the
        // top and bottom of letters were being chopped off. A polygon
        // clip-path with extreme vertical insets clips only at the
        // left/right edges and lets the line-box overflow vertically
        // freely, so descenders and any text-shadow halation render
        // in full.
        clipPath: 'polygon(0% -200%, 100% -200%, 100% 300%, 0% 300%)',
        // `contain: size` would over-constrain (forces a fixed size);
        // `contain: layout paint` isolates the box so the inline-
        // block child's max-content can never leak into the parent
        // flex's intrinsic size calculation.
        contain: 'layout paint',
        ...(isMarqueeing
          ? {
              WebkitMaskImage: maskImage,
              maskImage: maskImage,
            }
          : null),
      }}
    >
      <motion.span
        ref={innerRef}
        className="inline-block whitespace-nowrap will-change-transform"
        style={{
          x,
          // Negative vertical padding via line-height trick is messy;
          // instead we let the wrapper own a small extra vertical
          // breathing area through padding (see below). Keep the
          // inner span clean — its only job is the marquee transform.
        }}
      >
        {text}
      </motion.span>
    </span>
  );
}
