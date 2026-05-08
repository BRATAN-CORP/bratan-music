import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Visual unit: small "eyebrow" / "info" pill used above section
 * headings throughout the app — `<icon> <label>` chip on a soft
 * surface-elevated background with the muted-foreground text colour.
 *
 * The exact same shape was previously inlined nine times across
 * /home, /daily, /ai, /landing, /profile and the onboarding
 * ArtistPicker — same border, same backdrop-blur, same typography,
 * just two slight padding variants. Centralising it here keeps the
 * "small chip above the H2" rhythm consistent and gives a single
 * lever for future tweaks (token, font weight, etc.).
 *
 * Two density presets — `md` for hero-level eyebrows (px-3 py-1.5)
 * and `sm` for section-level eyebrows (px-2.5 py-1). Anything else
 * (icon size, gap override, alternate text size) goes through
 * `className` since it stays render-only.
 */
export type MetaChipSize = 'sm' | 'md';

export interface MetaChipProps extends React.HTMLAttributes<HTMLSpanElement> {
  size?: MetaChipSize;
}

export function MetaChip({ size = 'sm', className, ...rest }: MetaChipProps) {
  return (
    <span
      className={cn(
        // shape
        'inline-flex w-fit items-center gap-2 rounded-full',
        // surface
        'border border-border bg-[var(--color-surface-elevated)] backdrop-blur',
        // typography
        'text-xs font-medium text-muted-foreground',
        // density
        size === 'md' ? 'px-3 py-1.5' : 'px-2.5 py-1',
        className,
      )}
      {...rest}
    />
  );
}
