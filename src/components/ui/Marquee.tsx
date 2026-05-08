import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { animate, motion, useMotionValue, useMotionValueEvent, useReducedMotion } from 'motion/react';

interface MarqueeProps {
  /** Plain text payload — the original API. If `children` is also
   *  provided, `children` wins and `text` only feeds the default
   *  `aria-label`. */
  text?: string;
  /** Custom inline content. Use this when the marquee row needs to
   *  hold something more than a string — e.g. a row of clickable
   *  artist `<Link>`s separated by commas. The component still
   *  measures `scrollWidth` of the inner span vs the wrapper's
   *  `clientWidth` and animates when the content overflows; the
   *  consumer is responsible for keeping the rendered tree on a
   *  single line (`whitespace-nowrap`, `display: inline`, etc.). */
  children?: ReactNode;
  /** Stable identity of the current content. Used to trigger a
   *  synchronous re-measure when the content changes — the existing
   *  `ResizeObserver` handles size-only changes already, but a
   *  next-track swap arrives via React reconciliation and we want
   *  the animation timing to reset on the same paint as the new
   *  text. Defaults to `text`. Pass e.g. `track.id` when using
   *  `children`. */
  contentKey?: string;
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
  children,
  contentKey,
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

  // Synchronous measure trigger. `contentKey` (or `text` for the
  // legacy single-string callsites) flips on each next-track swap;
  // the `ResizeObserver` below catches mid-life size changes too.
  const measureKey = contentKey ?? text ?? '';

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
  }, [measureKey]);

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
  }, [measureKey]);

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
      aria-label={ariaLabel ?? text ?? undefined}
      style={{
        // Horizontal-only clipping. The box must never report a content
        // width larger than its container — a long inline-block child's
        // intrinsic max-content otherwise leaks into the parent flex's
        // sizing on iOS Safari and pushes siblings off screen. Plain
        // `overflow: hidden` clips vertically too and ate Cyrillic
        // ascenders/descenders ('у', 'д', 'й') in the fullscreen player
        // title. A polygon clip-path with extreme vertical insets clips
        // only at the left/right edges and lets the line-box overflow
        // vertically freely, so descenders and any text-shadow halation
        // render in full.
        clipPath: 'polygon(0% -200%, 100% -200%, 100% 300%, 0% 300%)',
        // `contain: layout` isolates the inline-block child's max-content
        // from the parent flex's intrinsic-size calc. `contain: paint`
        // would force the element to clip its own painting to the
        // bounding box — overriding the vertical bleed we want from the
        // clip-path and re-introducing the descender clipping. `layout`
        // alone is sufficient for size isolation.
        contain: 'layout',
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
        {children ?? text}
      </motion.span>
    </span>
  );
}
