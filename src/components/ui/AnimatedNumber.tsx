import { motion, useMotionValue, useSpring, useTransform } from 'motion/react';
import { useEffect } from 'react';

interface AnimatedNumberProps {
  value: number;
  format?: (n: number) => string;
  className?: string;
  duration?: number;
}

export function AnimatedNumber({ value, format, className }: AnimatedNumberProps) {
  const motionValue = useMotionValue(0);
  const spring = useSpring(motionValue, { stiffness: 60, damping: 18 });
  const display = useTransform(spring, (v) => (format ? format(v) : Math.round(v).toString()));

  // Animation starts immediately on mount instead of waiting for the
  // user to scroll the element into view.
  useEffect(() => {
    motionValue.set(value);
  }, [motionValue, value]);

  return (
    <motion.span className={className}>
      {display}
    </motion.span>
  );
}
