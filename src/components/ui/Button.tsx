import type { ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md' | 'lg' | 'icon';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

const variantClass: Record<ButtonVariant, string> = {
  primary: 'bg-primary text-primary-foreground shadow-[var(--shadow-glow)] hover:bg-[var(--color-accent-hover)]',
  secondary: 'bg-secondary text-secondary-foreground hover:bg-[var(--color-bg-muted)]',
  ghost: 'hover:bg-secondary text-muted-foreground hover:text-foreground',
  danger: 'bg-destructive text-destructive-foreground hover:opacity-90',
};

const sizeClass: Record<ButtonSize, string> = {
  sm: 'h-9 px-4 text-sm',
  md: 'h-11 px-5 text-sm',
  lg: 'h-13 px-7 text-base',
  icon: 'h-10 w-10',
};

export function Button({ className, variant = 'primary', size = 'md', ...props }: ButtonProps) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-full font-semibold transition-all duration-200 active:scale-95 disabled:pointer-events-none disabled:opacity-50',
        variantClass[variant],
        sizeClass[size],
        className
      )}
      {...props}
    />
  );
}
