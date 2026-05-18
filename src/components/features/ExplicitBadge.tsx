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
 *   - The letter is sized at ~70% of the box. To compensate for the
 *     caps-height-vs-mathematical-centre gap (caps-aligned glyphs sit
 *     slightly above the em-box centre that `inline-flex items-center`
 *     resolves to), the literal "E" lives in an inner block-level
 *     `<span>` whose `translateY` scales with the badge size: ~0.25 px
 *     on dense rows (≤12 px), ~0.5 px on standard rows (≤16 px),
 *     ~0.75 px on the FullscreenPlayer bucket (17-18 px) and 1 px on
 *     the larger hero surfaces (>18 px). The 18 px bucket is split
 *     out of the original `>16` bucket because 1/18 ≈ 5.5% read
 *     visibly high on the FullscreenPlayer hero, while 0.75/18 ≈
 *     4.2% is closer to the 0.5/14 = 3.6% baseline the previous
 *     design calibrated to.
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
  // Optical-centering correction. `inline-flex items-center` aligns
  // on the mathematical centre of the em-box, but caps-aligned glyphs
  // render slightly off that centre — and the residual drift scales
  // with the badge size. A single hardcoded lift looks right at 14 px
  // and visibly drifts at 18 px (FullscreenPlayer) and 24 px (Track
  // page hero). Bucketed corrections keep the glyph centred across
  // every size we use (12 / 14 / 18 / 20 / 24 px) without per-call
  // tuning. The 18 px bucket is split off so the FullscreenPlayer
  // hero (the most prominent surface) doesn't read high: 0.75/18 is
  // closer to the 0.5/14 baseline than 1/18 was.
  const innerLiftPx = size <= 12 ? 0.25 : size <= 16 ? 0.5 : size <= 18 ? 0.75 : 1;
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
      style={{
        width: size,
        height: size,
        fontSize,
        lineHeight: 1,
      }}
      aria-label={label}
      title={label}
    >
      <span
        style={{
          display: 'block',
          transform: `translateY(-${innerLiftPx}px)`,
        }}
      >
        E
      </span>
    </span>
  );
}
