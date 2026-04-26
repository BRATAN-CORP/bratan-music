import { motion, useInView, useMotionValue, useSpring, useTransform } from 'motion/react';
import { useEffect, useRef } from 'react';

interface AnimatedNumberProps {
  value: number;
  format?: (n: number) => string;
  className?: string;
  duration?: number;
}

export function AnimatedNumber({ value, format, className }: AnimatedNumberProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: '-20% 0px' });
  const motionValue = useMotionValue(0);
  const spring = useSpring(motionValue, { stiffness: 60, damping: 18 });
  const display = useTransform(spring, (v) => (format ? format(v) : Math.round(v).toString()));

  useEffect(() => {
    if (inView) motionValue.set(value);
  }, [inView, motionValue, value]);

  return (
    <motion.span ref={ref} className={className}>
      {display}
    </motion.span>
  );
}
