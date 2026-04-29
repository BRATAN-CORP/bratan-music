import { Link } from 'react-router-dom';
import type { ArtistRef } from '@/types';
import { cn } from '@/lib/utils';

/**
 * Render a comma-separated list of contributors where every name is
 * its own `<Link>` to the corresponding artist page. Falls back to a
 * plain string render when no structured `artists` list is available
 * but a single `artistId` exists, and finally to inert text.
 *
 * Behaviour:
 * - Multiple contributors → each name becomes its own anchor; clicking
 *   one opens that artist's page (works for "feat." / "&" / collabs).
 * - Single contributor with id → behaves exactly like before, one link.
 * - No id at all → plain text, kept for completeness so callers can use
 *   this component unconditionally.
 *
 * The component is intentionally inline-only — it lays out names with
 * a flex row that wraps so a long collaboration list doesn't break
 * truncation in track-row contexts. Wrap it in a parent with
 * `truncate` / `whitespace-nowrap` if you need single-line behaviour.
 */
interface ArtistLinksProps {
  /** Preferred shape: structured contributor list. */
  artists?: ArtistRef[] | null;
  /** Fallback joined string ("Artist A, Artist B"). */
  fallbackName?: string;
  /** Fallback id — used only when `artists` is empty/missing. */
  fallbackId?: string;
  /** Optional className applied to each link/span. */
  className?: string;
  /** Stop propagation so clicks don't trigger an outer row's onClick. */
  stopPropagation?: boolean;
  /** Wrapper className (controls the row container). */
  wrapperClassName?: string;
  /** Custom separator. Defaults to ", ". */
  separator?: string;
}

export function ArtistLinks({
  artists,
  fallbackName,
  fallbackId,
  className,
  stopPropagation = true,
  wrapperClassName,
  separator = ', ',
}: ArtistLinksProps) {
  const list = artists && artists.length > 0 ? artists : null;

  if (!list) {
    if (fallbackId && fallbackName) {
      return (
        <Link
          to={`/artist/${fallbackId}`}
          onClick={stopPropagation ? (e) => e.stopPropagation() : undefined}
          className={cn('hover:text-foreground hover:underline', className)}
        >
          {fallbackName}
        </Link>
      );
    }
    return <span className={cn(wrapperClassName, className)}>{fallbackName ?? ''}</span>;
  }

  return (
    <span className={cn('inline-flex flex-wrap items-baseline gap-x-0', wrapperClassName)}>
      {list.map((a, i) => (
        <span key={a.id + ':' + i} className="contents">
          <Link
            to={`/artist/${a.id}`}
            onClick={stopPropagation ? (e) => e.stopPropagation() : undefined}
            className={cn('hover:text-foreground hover:underline', className)}
          >
            {a.name}
          </Link>
          {i < list.length - 1 && (
            <span className={cn('whitespace-pre', className)}>{separator}</span>
          )}
        </span>
      ))}
    </span>
  );
}
