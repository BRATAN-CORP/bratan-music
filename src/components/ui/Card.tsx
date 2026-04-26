import type { HTMLAttributes } from 'react';
import { motion, type HTMLMotionProps } from 'motion/react';
import { cn } from '@/lib/utils';

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'rounded-[var(--radius-lg)] border border-border bg-card text-card-foreground transition-colors duration-200',
        className
      )}
      {...props}
    />
  );
}

export function CardContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-5', className)} {...props} />;
}

export function MotionCard({ className, ...props }: HTMLMotionProps<'div'>) {
  return (
    <motion.div
      whileHover={{ y: -2 }}
      transition={{ type: 'spring', stiffness: 320, damping: 28 }}
      className={cn(
        'rounded-[var(--radius-lg)] border border-border bg-card text-card-foreground transition-colors duration-200 hover:border-[var(--color-border-strong)]',
        className
      )}
      {...props}
    />
  );
}
