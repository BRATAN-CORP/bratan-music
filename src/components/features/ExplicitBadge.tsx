/**
 * Small "E" badge for tracks / albums / playlists the source provider
 * tags as Explicit.
 *
 * Implementation: SVG-based. Earlier iterations tried to centre an
 * inline `<span>E</span>` inside a fixed-size flex box using
 * `transform: translateY(-Xpx)` to fight the caps-vs-em-box gap of the
 * loaded font. That approach was font-dependent and the user
 * repeatedly reported the glyph reading "off-centre / too-much-padding"
 * in mini-player rows and track lists. SVG removes the font-metrics
 * dependency entirely: the path geometry is centred against the same
 * 10×10 viewBox at every render, so the badge is pixel-stable across
 * Inter / Instrument-Serif / system fallbacks at every supported size
 * (12 / 14 / 16 / 18 / 20 / 24 px).
 *
 * Visual contract (set against Apple Music / Spotify / Tidal Web):
 *   - Solid filled square with rounded corners and a high-contrast "E".
 *   - Default ("auto") tone is theme-aware: a `--color-text-muted`
 *     filled square with the surface colour cut out of the letter.
 *   - Optional `tone="light"` paints a white-on-translucent variant
 *     for surfaces forced light independent of the user's theme
 *     (e.g. the fullscreen player painting over cover ambience).
 *
 * Layout contract:
 *   - `inline-flex shrink-0` with a tight pixel box, so the badge
 *     never reflows the parent on truncate and never disappears under
 *     a long title.
 *   - Renders nothing when `explicit !== true`, so callers can drop it
 *     inline next to a title without conditional wrappers.
 *
 * Usage:
 *   <span className="flex items-center gap-1">
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
   * pairs cleanly with the 12–14 px title sizes used across track rows
   * and the mini player. Use 12 for dense rows and 16–24 for hero
   * surfaces (fullscreen player, album / playlist heroes).
   */
  size?: number;
  /**
   * Visual tone.
   *
   * - `auto` (default): theme-aware — `--color-text-muted` square with
   *   the surface colour cut out of the letter. Inherits the
   *   surrounding palette under both themes.
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

  const label = t('track.explicitBadge');

  // Two flat colours per tone. Both render as plain `fill=…` SVG paint
  // — using `currentColor` everywhere would force the consumer to
  // wrap the badge in an extra `text-…` class, and we want the badge
  // to be self-contained.
  const palette =
    tone === 'light'
      ? { bg: 'rgba(255,255,255,0.92)', fg: 'rgba(0,0,0,0.85)' }
      : { bg: 'var(--color-text-muted)', fg: 'var(--color-bg)' };

  // 10×10 viewBox with a 1.6-radius corner gives the same visual
  // softness as Tidal's own badge at every output size. The "E"
  // path is centred at (5,5) with caps height 6 — geometrically
  // identical to a 60-of-10 caps-aligned glyph but without any
  // font-metric dependence. Stroke width 0.2 nudges the path
  // anti-alias closer to the glyph weight rendered by the
  // surrounding text.
  return (
    <span
      className={
        'inline-flex shrink-0 select-none items-center justify-center align-middle ' +
        (className ? ' ' + className : '')
      }
      style={{ width: size, height: size, lineHeight: 1 }}
      aria-label={label}
      title={label}
      role="img"
    >
      <svg
        viewBox="0 0 10 10"
        width={size}
        height={size}
        style={{ display: 'block' }}
        aria-hidden="true"
        focusable="false"
      >
        {/* Background square. Inline `style.fill` so CSS custom
         *  properties (`var(--color-text-muted)` etc.) resolve
         *  correctly in every browser — the `fill="…"` SVG attribute
         *  has had var() support quirks historically. */}
        <rect x="0" y="0" width="10" height="10" rx="1.6" ry="1.6" style={{ fill: palette.bg }} />
        {/* Capital "E" rendered as a single closed path. Bars: top
         *  (y=2 → 3.4), middle (y=4.5 → 5.5), bottom (y=6.6 → 8).
         *  Vertical spine x=2.4 → 3.4. The geometry visually
         *  centres at (5, 5) — top + bottom bars are equidistant
         *  from the centreline, the middle bar is exactly on it,
         *  and the spine width matches the bar thickness so weight
         *  reads even on dark/light backgrounds. */}
        <path
          style={{ fill: palette.fg }}
          d="M2.4 2 H7.6 V3.4 H3.4 V4.5 H7 V5.5 H3.4 V6.6 H7.6 V8 H2.4 Z"
        />
      </svg>
    </span>
  );
}
