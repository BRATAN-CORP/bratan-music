import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';

interface PageTransitionProps {
  children: ReactNode;
}

export function PageTransition({ children }: PageTransitionProps) {
  const location = useLocation();
  const reduce = useReducedMotion();

  // No `mode="wait"` on purpose: `wait` keeps the next page unmounted
  // until the previous page's exit animation finishes, and if the exit
  // callback ever stalls (e.g. when the user navigates away and back to
  // the same route while another transition is mid-flight) the new
  // route never mounts and the user sees an empty page until they hit
  // F5. With sync (default) mode the new page mounts immediately and
  // simply layers over the outgoing one.
  return (
    <AnimatePresence initial={false}>
      <motion.div
        key={location.pathname}
        initial={reduce ? false : { opacity: 0, y: 8 }}
        animate={reduce ? undefined : { opacity: 1, y: 0 }}
        exit={reduce ? undefined : { opacity: 0, y: -8 }}
        transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
        className="min-h-full"
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
