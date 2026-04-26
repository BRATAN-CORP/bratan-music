import type { ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'outline' | 'danger';
type ButtonSize = 'sm' | 'md' | 'lg' | 'icon';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

const variantClass: Record<ButtonVariant, string> = {
  primary: 'bg-primary text-primary-foreground shadow-[0_2px_8px_-2px_var(--color-accent-glow)] hover:bg-[var(--color-accent-hover)] hover:shadow-[0_4px_16px_-4px_var(--color-accent-glow)] active:scale-[0.98]',
  secondary: 'bg-secondary text-secondary-foreground hover:bg-[var(--color-bg-muted)] active:scale-[0.98]',
  outline: 'border border-border bg-transparent text-foreground hover:bg-secondary hover:border-[var(--color-border-strong)] active:scale-[0.98]',
  ghost: 'text-muted-foreground hover:bg-secondary hover:text-foreground active:scale-[0.98]',
  danger: 'bg-destructive text-destructive-foreground hover:opacity-90 active:scale-[0.98]',
};

const sizeClass: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-sm',
  md: 'h-10 px-4 text-sm',
  lg: 'h-11 px-6 text-base',
  icon: 'h-9 w-9',
};

export function Button({ className, variant = 'primary', size = 'md', ...props }: ButtonProps) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-[var(--radius-md)] font-medium transition-all duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50',
        variantClass[variant],
        sizeClass[size],
        className
      )}
      {...props}
    />
  );
}
