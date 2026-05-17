/**
 * Small "E" badge for tracks the source provider tags as Explicit.
 *
 * Design goals — set by the user when commissioning this control:
 *   1. Surface uncensored tracks at a glance everywhere a track title
 *      shows up (rows, player, queue, search, share pages).
 *   2. Match Apple Music / Spotify visual vocabulary so it reads as
 *      "Explicit" without copy. Filled rounded square with capital "E",
 *      neutral muted tone — never accent — so it doesn't compete with
 *      the OfflineBadge that often sits in the same flex row.
 *   3. Layout-safe: `inline-flex shrink-0` with a fixed pixel box so
 *      truncating titles never reflow because of the badge, and the
 *      badge itself never disappears under `truncate`.
 *
 * Renders nothing for clean tracks so callers can drop it inline next
 * to a title without conditional wrappers / extra layout shifts.
 *
 * Usage:
 *   <span className="flex items-center gap-1.5">
 *     <span className="truncate">{track.title}</span>
 *     <ExplicitBadge explicit={track.explicit} />
 *   </span>
 */
import { useT } from '@/i18n';

interface ExplicitBadgeProps {
  /** Source-provider Explicit flag. Anything not strictly `true` renders nothing. */
  explicit: boolean | undefined | null;
  /**
   * Pixel size of the badge box (width = height). Defaults to 14, which
   * pairs cleanly with the 12-14px title sizes used across track rows
   * and the mini player. Use 12 for dense rows and 16-18 for hero
   * surfaces (fullscreen player).
   */
  size?: number;
  className?: string;
}

export function ExplicitBadge({ explicit, size = 14, className = '' }: ExplicitBadgeProps) {
  const t = useT();
  if (explicit !== true) return null;

  // Font-size scales with the box but stays floor-clamped so the "E"
  // remains legible even at size=12. The 0.7 multiplier was tuned
  // against the OfflineBadge/Ban icons that sit on the same baseline.
  const fontSize = Math.max(8, Math.round(size * 0.7));
  const label = t('track.explicitBadge');

  return (
    <span
      className={
        'inline-flex shrink-0 select-none items-center justify-center font-semibold uppercase ' +
        'rounded-[3px] bg-[color:var(--color-bg-muted)] text-[color:var(--color-text-muted)] ' +
        'leading-none tracking-tight ' +
        className
      }
      style={{ width: size, height: size, fontSize }}
      aria-label={label}
      title={label}
    >
      E
    </span>
  );
}
