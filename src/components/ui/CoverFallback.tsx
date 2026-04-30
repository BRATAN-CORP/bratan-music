import { useState } from 'react';
import { fallbackGradient, nameInitials } from '@/lib/coverFallback';
import { cn } from '@/lib/utils';

interface SmartImageProps {
  /** Source URL. If null/undefined, fallback renders immediately. */
  src?: string | null;
  /** Name used to seed the gradient hue + initials when fallback shows. */
  name: string;
  alt?: string;
  /** Tailwind class string applied to the OUTER container — sets shape (rounded-full vs rounded-md). */
  className?: string;
  /** Multiplier for the initials font size relative to the container. */
  initialsClassName?: string;
  loading?: 'lazy' | 'eager';
}

/**
 * Single source of truth for "show a cover/avatar OR a stylised
 * coloured-initials fallback if it's missing or fails to load".
 *
 * Used for:
 *   - artist avatars (rounded-full) — replaces a hodgepodge of
 *     `User` icon / generic gray circle fallbacks across cards,
 *     onboarding picker and search results.
 *   - track / album / playlist covers (rounded-md) — replaces the
 *     `Music` / `Disc3` icon-on-grey fallback that user-uploaded
 *     coverless tracks used to render with.
 *
 * The hue is hashed off the `name` so the same artist/track always
 * renders with the same colour — long lists (search results, the
 * uploads page, queue) read as a varied grid instead of a wall of
 * identical placeholders.
 */
export function CoverFallback({ src, name, alt, className, initialsClassName, loading = 'lazy' }: SmartImageProps) {
  const [errored, setErrored] = useState(false);
  const showImage = !!src && !errored;
  if (showImage) {
    return (
      <img
        src={src}
        alt={alt ?? name}
        loading={loading}
        onError={() => setErrored(true)}
        className={cn('h-full w-full object-cover', className)}
      />
    );
  }
  return (
    <div
      className={cn(
        'flex h-full w-full items-center justify-center font-semibold tracking-wide text-white',
        initialsClassName ?? 'text-base',
        className,
      )}
      style={{ background: fallbackGradient(name) }}
      aria-label={alt ?? name}
      role="img"
    >
      {nameInitials(name)}
    </div>
  );
}
