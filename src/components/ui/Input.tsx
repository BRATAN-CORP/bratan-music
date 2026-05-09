import { forwardRef, type InputHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return (
      <input
        ref={ref}
        className={cn(
          'h-10 w-full rounded-[var(--radius-md)] border border-input bg-background px-3 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-foreground focus-visible:ring-1 focus-visible:ring-ring',
          className
        )}
        {...props}
      />
    );
  }
);
