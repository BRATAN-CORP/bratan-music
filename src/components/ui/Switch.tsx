import { motion } from 'motion/react';
import { cn } from '@/lib/utils';

interface SwitchProps {
  checked: boolean;
  onCheckedChange: (next: boolean) => void;
  disabled?: boolean;
  ariaLabel?: string;
  className?: string;
}

/**
 * Single visual contract for every on/off toggle in the app. The
 * profile page used to inline this same `role="switch"` button + motion
 * thumb in three different sections, with hand-typed sizes that drifted
 * by a pixel or two between sections. Centralising here keeps the
 * profile (and any future settings surface) visually consistent.
 */
export function Switch({
  checked,
  onCheckedChange,
  disabled,
  ariaLabel,
  className,
}: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        'disabled:cursor-not-allowed disabled:opacity-50',
        checked ? 'bg-[var(--color-accent)]' : 'bg-secondary',
        className,
      )}
    >
      <motion.span
        animate={{ x: checked ? 24 : 4 }}
        transition={{ type: 'spring', stiffness: 500, damping: 35 }}
        className="inline-block h-4 w-4 rounded-full bg-white shadow"
      />
    </button>
  );
}
