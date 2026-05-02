import { useEffect, useReducer, useRef, type ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useI18n } from '@/i18n';

/**
 * Cross-fade-and-lift wrapper that nudges the entire app whenever the
 * active locale flips. Without it, switching language causes the UI
 * to snap to the new copy mid-frame — readable but jarring, especially
 * on dense screens like the explore feed where every section header
 * repaints at once.
 *
 * The transition is intentionally tiny:
 *   - 200 ms total (cross-fade in, out is faster — 120 ms)
 *   - 4 px translateY so motion-blind users aren't getting a parallax
 *     swoop, just a gentle "page settles" cue
 *   - `mode="wait"` is *not* used: we want the new locale's children
 *     to fade in over the dimming-out outgoing copy, otherwise there's
 *     a perceptible blank frame on slow CPUs (Telegram WebView on
 *     low-end Android) which reads as a layout glitch
 *
 * On `prefers-reduced-motion` the wrapper short-circuits and just
 * renders children directly so the OS-level setting is honoured.
 *
 * Why not put this inside `I18nProvider`? The provider is the source
 * of truth for the locale value itself; mixing presentation concerns
 * (motion, layout) into the provider would force every test that
 * mounts the provider to deal with framer-motion. Keeping them
 * separate also means future swaps (e.g. dropping the fade for a
 * stagger or a coloured sweep) don't touch the i18n core.
 *
 * The first paint never animates — `key` starts at the *current*
 * locale so AnimatePresence treats it as the initial child.
 */
export function LocaleFade({ children }: { children: ReactNode }) {
  const { locale } = useI18n();
  const reducedMotion = useReducedMotion();
  // Bump a counter on every locale change so AnimatePresence sees a
  // brand-new child and runs the exit/enter pair. Using `locale` as
  // the key directly works too, but a counter gives identical behaviour
  // even if a future locale swap goes ru→en→ru within a single render
  // tick (e.g. system test that toggles fast).
  const [tick, bump] = useReducer((n: number) => n + 1, 0);
  const previous = useRef(locale);
  useEffect(() => {
    if (previous.current === locale) return;
    previous.current = locale;
    bump();
  }, [locale]);

  if (reducedMotion) return <>{children}</>;

  return (
    <AnimatePresence initial={false}>
      <motion.div
        key={tick}
        initial={{ opacity: 0.55, y: 4, filter: 'blur(2px)' }}
        animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
        exit={{ opacity: 0, y: -4, filter: 'blur(2px)' }}
        transition={{
          opacity: { duration: 0.2, ease: [0.22, 1, 0.36, 1] },
          y: { duration: 0.2, ease: [0.22, 1, 0.36, 1] },
          filter: { duration: 0.16, ease: 'easeOut' },
        }}
        // Lift onto its own compositor layer so the cross-fade doesn't
        // repaint the giant track grids underneath every frame.
        style={{ willChange: 'opacity, transform, filter' }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
