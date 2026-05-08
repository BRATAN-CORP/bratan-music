import { Fragment } from 'react';
import { Link } from 'react-router-dom';
import type { ArtistRef } from '@/types';
import { cn } from '@/lib/utils';
import { looksMultiCreditName, splitCredits } from '@/lib/artistCredit';

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
  /** Force the whole credit list onto a single non-wrapping line.
   *  Used by player surfaces (mini, dock, fullscreen) so a long
   *  collaboration list never grows the column vertically — instead
   *  the row is wrapped in a Marquee that scrolls horizontally. */
  nowrap?: boolean;
}

export function ArtistLinks({
  artists,
  fallbackName,
  fallbackId,
  className,
  stopPropagation = true,
  wrapperClassName,
  separator = ', ',
  nowrap = false,
}: ArtistLinksProps) {
  const rowClass = nowrap
    ? 'inline whitespace-nowrap'
    : 'inline-flex flex-wrap items-baseline gap-x-0';
  const list = artists && artists.length > 0 ? artists : null;

  // Trust the structured list only if it carries multi-credit
  // information cleanly: either ≥2 entries, or a single entry whose
  // name doesn't itself look like a joined-multi-credit string.
  // Tidal occasionally collapses "Drake & Future" into a single
  // contributor row whose `name` is the joined string; rendering
  // THAT as one link silently sends every visible name to the
  // primary id ("clicking 'Future' goes to Drake's page" — the
  // exact bug the user keeps hitting). Falling through to the
  // fallback path below splits the joined name visually instead.
  const trustList = list !== null && (list.length > 1 || !looksMultiCreditName(list[0]?.name));

  if (!trustList) {
    // Pick the best-available display string. A single-entry but
    // collapsed `artists` row beats `fallbackName` (it's typically
    // the cleaned-up version), but if it's missing we fall back
    // straight to the joined string from the upstream payload.
    const collapsedName = list && list.length === 1 ? list[0]?.name ?? null : null;
    const text = collapsedName ?? fallbackName ?? '';
    const looksMulti = looksMultiCreditName(text);

    if (looksMulti) {
      // Multi-credit fallback: split into individual chunks and
      // render each as plain text. The user sees every name as a
      // visually separate token (with its original separator) but
      // there's no link to navigate — and crucially no WRONG link
      // that would silently route every name to the primary id.
      // The kebab menu's "Перейти к артисту" still surfaces the
      // primary artist for navigation. Once the upstream is
      // correctly populated (post-migration 0024 history rows,
      // freshly-mapped Tidal tracks) the `trustList` branch above
      // takes over and each name gets its own anchor again.
      const chunks = splitCredits(text);
      if (chunks.length > 1) {
        return (
          <span className={cn(rowClass, wrapperClassName)}>
            {chunks.map((c, i) => (
              <Fragment key={`${c.text}:${i}`}>
                <span className={cn(className)}>{c.text}</span>
                {i < chunks.length - 1 && (
                  <span className={cn('whitespace-pre', className)}>
                    {c.sep || separator}
                  </span>
                )}
              </Fragment>
            ))}
          </span>
        );
      }
      // Splitting yielded only one chunk (the regex matched but the
      // whole string was empty either side) — render as plain text.
      return <span className={cn(wrapperClassName, className)}>{text}</span>;
    }

    // Clean single-credit name → keep the original Link behaviour.
    if (fallbackId && text) {
      return (
        <Link
          to={`/artist/${fallbackId}`}
          onClick={stopPropagation ? (e) => e.stopPropagation() : undefined}
          className={cn('hover:text-foreground hover:underline', className)}
        >
          {text}
        </Link>
      );
    }
    return <span className={cn(wrapperClassName, className)}>{text}</span>;
  }

  // Trustworthy structured list → each contributor gets its own link.
  return (
    <span className={cn(rowClass, wrapperClassName)}>
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
