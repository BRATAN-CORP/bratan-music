import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

type IconButtonSize = 'sm' | 'md' | 'lg';
type IconButtonTone = 'neutral' | 'accent' | 'danger';
type IconButtonVariant = 'outline' | 'ghost' | 'filled';

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  size?: IconButtonSize;
  tone?: IconButtonTone;
  variant?: IconButtonVariant;
  /**
   * Persistent active state — used for like / follow / pin toggles.
   * When true, the button paints in its tone's accent palette (filled
   * tint + accent border + accent text) regardless of variant. When
   * false, the button paints in `variant`'s neutral palette.
   */
  active?: boolean;
  children: ReactNode;
}

const sizeClass: Record<IconButtonSize, string> = {
  sm: 'h-8 w-8',
  md: 'h-9 w-9',
  lg: 'h-11 w-11',
};

const idleClass: Record<IconButtonVariant, string> = {
  outline:
    'border border-border bg-transparent text-muted-foreground hover:bg-[var(--color-hover-overlay)] hover:text-foreground',
  ghost:
    'border border-transparent bg-transparent text-muted-foreground hover:bg-[var(--color-hover-overlay)] hover:text-foreground',
  filled:
    'border border-transparent bg-secondary text-foreground hover:bg-[var(--color-bg-muted)]',
};

const activeClass: Record<IconButtonTone, string> = {
  neutral:
    'border border-[var(--color-border-strong)] bg-secondary text-foreground',
  accent:
    'border border-[var(--color-accent)]/30 bg-[var(--color-accent)]/15 text-[var(--color-accent)]',
  danger:
    'border border-[var(--color-danger)]/30 bg-[var(--color-danger-muted)] text-[var(--color-danger)]',
};

/**
 * Round, single-icon action button. Centralises the like / share /
 * follow / pin / dislike / offline-save buttons that today are
 * hand-rolled with similar-but-not-identical Tailwind on every
 * page-hero call site.
 *
 * The component is unopinionated about which icon you put inside —
 * pass any `lucide-react` (or other) icon as a child. `aria-label` is
 * required since there's no visible text label.
 */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  function IconButton(
    {
      size = 'md',
      tone = 'neutral',
      variant = 'outline',
      active = false,
      className,
      children,
      ...props
    },
    ref,
  ) {
    return (
      <button
        ref={ref}
        type={props.type ?? 'button'}
        className={cn(
          'inline-flex shrink-0 items-center justify-center rounded-full transition-all duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background active:scale-95 disabled:pointer-events-none disabled:opacity-50',
          sizeClass[size],
          active ? activeClass[tone] : idleClass[variant],
          className,
        )}
        {...props}
      >
        {children}
      </button>
    );
  },
);
