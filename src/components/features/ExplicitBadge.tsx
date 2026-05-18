/**
 * Small "E" badge for tracks / albums / playlists the source provider
 * tags as Explicit.
 *
 * Visual contract (set against Apple Music / Spotify / Tidal Web):
 *   - Solid filled square with a high-contrast capital "E".
 *   - Default ("auto") tone is theme-aware: a `--color-text-muted`
 *     filled square with the surface colour cut out of the letter, so
 *     the badge inherits whatever palette the surrounding row uses
 *     under both light and dark themes.
 *   - Optional `tone="light"` paints a white-on-translucent variant
 *     for surfaces that are forced light independently of the user's
 *     theme — e.g. the fullscreen player which paints over
 *     cover-derived ambience and always reads as "light".
 *
 * Layout contract:
 *   - `inline-flex shrink-0` with a tight pixel box, so the badge
 *     never reflows the parent on truncate and never disappears under
 *     a long title.
 *   - The letter is sized at ~70% of the box; a 1 px optical lift
 *     compensates for the caps-height-vs-mathematical-centre gap so
 *     the badge sits on the same visual baseline as the title's caps
 *     (was floating slightly low in the previous revision).
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

export type ExplicitBadgeTone = 'auto' | 'light';

interface ExplicitBadgeProps {
  /** Source-provider Explicit flag. Anything not strictly `true` renders nothing. */
  explicit: boolean | undefined | null;
  /**
   * Pixel size of the badge box (width = height). Defaults to 14, which
   * pairs cleanly with the 12-14px title sizes used across track rows
   * and the mini player. Use 12 for dense rows and 16-18 for hero
   * surfaces (fullscreen player, album / playlist heroes).
   */
  size?: number;
  /**
   * Visual tone.
   *
   * - `auto` (default): theme-aware filled square — `--color-text-muted`
   *   square with the surface colour cut out of the letter. Inherits
   *   the surrounding palette under both themes.
   * - `light`: white-on-translucent for surfaces forced light
   *   regardless of theme (e.g. fullscreen player).
   */
  tone?: ExplicitBadgeTone;
  className?: string;
}

export function ExplicitBadge({
  explicit,
  size = 14,
  tone = 'auto',
  className = '',
}: ExplicitBadgeProps) {
  const t = useT();
  if (explicit !== true) return null;

  // Letter at ~70% of the box keeps the visual weight close to Apple
  // Music's badge while leaving ~1 px of inset all-around so the
  // corner radius reads. Floor at 9 px so it remains legible at the
  // densest row size we use (12 px box).
  const fontSize = Math.max(9, Math.round(size * 0.7));
  const label = t('track.explicitBadge');

  const toneClasses =
    tone === 'light'
      ? 'bg-white/90 text-black/85'
      : 'bg-[color:var(--color-text-muted)] text-[color:var(--color-bg)]';

  return (
    <span
      className={
        'inline-flex shrink-0 select-none items-center justify-center font-bold uppercase ' +
        'rounded-[3px] leading-none tracking-tight ' +
        toneClasses +
        ' ' +
        className
      }
      // Vertical alignment: `inline-flex items-center` centres the
      // box on the parent's middle, but caps-height-aligned text sits
      // slightly above that mathematical centre — so the badge reads
      // ~1 px low next to lowercase-ending titles. A tiny upward
      // translate corrects the optical drift without disturbing
      // layout (it's purely a paint-time transform).
      style={{
        width: size,
        height: size,
        fontSize,
        transform: 'translateY(-0.5px)',
      }}
      aria-label={label}
      title={label}
    >
      E
    </span>
  );
}
