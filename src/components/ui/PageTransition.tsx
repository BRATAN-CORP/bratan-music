import { motion, useReducedMotion } from 'motion/react';
import { useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';

interface PageTransitionProps {
  children: ReactNode;
}

/**
 * Per-route fade-in for page content. The previous implementation wrapped
 * `children` in `AnimatePresence` so it could play an exit animation
 * before mounting the next page, but `AnimatePresence` (in either
 * `sync` or `wait` mode) was the root cause of the long-standing
 * "huge empty space appears above/below the page on navigation" bug:
 *
 * - `mode="sync"` (default) keeps the exiting page mounted alongside
 *   the entering page for the duration of the exit animation. Both
 *   `motion.div` siblings sat in normal document flow with `min-h-full`,
 *   so for ~0.28 s after every navigation the page height was DOUBLE
 *   what the user expected. If the user scrolled in that window —
 *   or if the exit animation stalled because of a tab-switch / RAF
 *   pause — the artefact stuck around and the user saw a screen of
 *   empty space before or after the real content.
 *
 * - `mode="wait"` solved the doubled-height issue but introduced
 *   a different one: if the exit callback never resolved (e.g. the
 *   user navigated mid-transition), the next page never mounted at
 *   all and the user saw a blank page until they hit refresh.
 *
 * The pragmatic fix is to drop the exit animation entirely. We just
 * fade-in each page when it mounts, keyed by pathname so a route
 * change unmounts the previous page synchronously and remounts the
 * new one with a fresh entrance. No two pages ever coexist in the
 * tree, so the layout can never be doubled.
 */
export function PageTransition({ children }: PageTransitionProps) {
  const location = useLocation();
  const reduce = useReducedMotion();

  return (
    <motion.div
      key={location.pathname}
      initial={reduce ? false : { opacity: 0, y: 8 }}
      animate={reduce ? undefined : { opacity: 1, y: 0 }}
      transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
      className="min-h-full"
    >
      {children}
    </motion.div>
  );
}
