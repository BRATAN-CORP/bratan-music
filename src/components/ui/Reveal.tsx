import { motion, useReducedMotion, type HTMLMotionProps } from 'motion/react';
import { type ReactNode } from 'react';
import { EASE_SPRING } from '@/lib/motion';

interface RevealProps extends HTMLMotionProps<'div'> {
  delay?: number;
  duration?: number;
  y?: number;
  once?: boolean;
  children: ReactNode;
}

export function Reveal({
  delay = 0,
  duration = 0.8,
  y = 24,
  once = true,
  children,
  ...rest
}: RevealProps) {
  const reduce = useReducedMotion();

  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y }}
      whileInView={reduce ? undefined : { opacity: 1, y: 0 }}
      viewport={{ once, margin: '-10% 0px -10% 0px' }}
      transition={{ duration, delay, ease: EASE_SPRING }}
      {...rest}
    >
      {children}
    </motion.div>
  );
}

interface StaggerProps {
  children: ReactNode;
  delay?: number;
  stagger?: number;
  className?: string;
}

export function Stagger({ children, delay = 0, stagger = 0.06, className }: StaggerProps) {
  const reduce = useReducedMotion();

  return (
    <motion.div
      className={className}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, margin: '-10% 0px -10% 0px' }}
      variants={{
        hidden: {},
        show: {
          transition: reduce
            ? { duration: 0 }
            : { staggerChildren: stagger, delayChildren: delay },
        },
      }}
    >
      {children}
    </motion.div>
  );
}
