import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';

interface PageTransitionProps {
  children: ReactNode;
}

export function PageTransition({ children }: PageTransitionProps) {
  const location = useLocation();
  const reduce = useReducedMotion();

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={location.pathname}
        initial={reduce ? false : { opacity: 0, y: 8 }}
        animate={reduce ? undefined : { opacity: 1, y: 0 }}
        exit={reduce ? undefined : { opacity: 0, y: -8 }}
        transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
        className="min-h-full"
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
