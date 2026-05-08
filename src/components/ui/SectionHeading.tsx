import { type ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface EyebrowProps {
  children: ReactNode;
  className?: string;
}

/**
 * Tiny uppercase tag rendered above page titles ("ALBUM" /
 * "ARTIST" / "PLAYLIST") and section dividers. Matches the
 * letter-spacing used today on hero pages so the visual rhythm is
 * preserved when the album / artist / playlist heroes migrate to
 * `<PageHero>`.
 */
export function Eyebrow({ children, className }: EyebrowProps) {
  return (
    <span
      className={cn(
        'text-xs font-medium uppercase tracking-[0.25em] text-muted-foreground',
        className,
      )}
    >
      {children}
    </span>
  );
}

interface SectionHeadingProps {
  children: ReactNode;
  /** Optional right-aligned slot for actions ("View all" links, sort
   *  toggles, etc). */
  trailing?: ReactNode;
  className?: string;
  /** Render the heading as `<h2>` (default) or `<h3>` for nested
   *  sections inside a hero / page. */
  as?: 'h2' | 'h3';
}

/**
 * Standard section header used between content blocks (Top tracks,
 * Albums, Singles, …). Centralises the type scale + spacing that today
 * is duplicated on the artist / library / explore pages.
 */
export function SectionHeading({
  children,
  trailing,
  className,
  as = 'h2',
}: SectionHeadingProps) {
  const Tag = as;
  return (
    <div className={cn('mb-3 flex items-baseline justify-between gap-3', className)}>
      <Tag className="text-base font-semibold tracking-tight sm:text-lg">{children}</Tag>
      {trailing ? <div className="shrink-0">{trailing}</div> : null}
    </div>
  );
}
