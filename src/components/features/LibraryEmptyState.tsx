import { motion } from 'motion/react';
import { type LucideIcon } from 'lucide-react';
import { type ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface LibraryEmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  /** Optional CTA — usually a `<Button>` from the consumer. */
  action?: ReactNode;
  className?: string;
}

/**
 * Polished empty-state card used by the Library tabs (Playlists,
 * Albums, Artists, Downloaded) when the user hasn't saved anything
 * yet. The card uses the soft `.liquid-glass` recipe so it sits
 * harmoniously with the hero above; the icon orbits inside three
 * concentric rings to signal "nothing here yet, but action is
 * possible". `prefers-reduced-motion` users see the rings without
 * the orbit (the global @media block in `globals.scss` collapses
 * the spin keyframe).
 */
export function LibraryEmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: LibraryEmptyStateProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
      className={cn(
        'liquid-glass liquid-glass--soft relative flex flex-col items-center gap-4 rounded-[var(--radius-xl)] px-6 py-16 text-center',
        className,
      )}
    >
      {/* Concentric ring stack — three rings of increasing radius
          painted via inline styles so we can drive the spin via
          motion. The outer ring is dashed for a "blueprint" feel,
          the inner ring is solid. The icon sits dead-centre. */}
      <div className="relative h-32 w-32">
        <motion.div
          className="absolute inset-0 rounded-full border border-dashed border-[var(--color-border-strong)]"
          animate={{ rotate: 360 }}
          transition={{ duration: 24, repeat: Infinity, ease: 'linear' }}
        />
        <motion.div
          className="absolute inset-3 rounded-full border border-[var(--color-border)]"
          animate={{ rotate: -360 }}
          transition={{ duration: 18, repeat: Infinity, ease: 'linear' }}
        />
        <div className="absolute inset-6 flex items-center justify-center rounded-full border border-[var(--color-border)] bg-[var(--color-bg-muted)] text-[var(--color-accent)]">
          <Icon size={28} />
        </div>
        {/* Soft accent halo to lift the icon off the panel. */}
        <div
          aria-hidden
          className="absolute inset-0 -z-10 rounded-full"
          style={{
            background:
              'radial-gradient(circle at center, var(--color-accent-glow) 0%, transparent 65%)',
            filter: 'blur(20px)',
            opacity: 0.6,
          }}
        />
      </div>

      <div className="flex flex-col gap-1.5 max-w-sm">
        <h3 className="text-lg font-semibold tracking-tight">{title}</h3>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>

      {action ? <div className="mt-2">{action}</div> : null}
    </motion.div>
  );
}
