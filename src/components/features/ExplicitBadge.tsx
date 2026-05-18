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
 *   - Letter is sized at ~70% of the box and rendered inside an inner
 *     `<span>` whose `transform: translateY(-Xpx)` corrects the
 *     caps-height-vs-mathematical-centre gap that makes the bare
 *     letter sit visibly low. The lift is scaled per size bucket so
 *     the optical centring holds at every callsite (12 / 14 / 18 /
 *     24 px). The previous implementation hardcoded the lift on the
 *     OUTER box and only looked correct at 14 px.
 *   - `padding: 0` and `lineHeight: 1` on the outer box, plus
 *     `display: block` on the inner span, prevents the small extra
 *     space some browsers reserve under inline text from
 *     un-centring the glyph horizontally on the right edge.
 *
 * Renders nothing for clean tracks so callers can drop it inline next
 * to a title without conditional wrappers / extra layout shifts.
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

/**
 * Optical-centring lift in pixels. The bare capital "E" rendered at
 * `lineHeight: 1` sits with its visual centre roughly at 56% of the
 * em-box height (caps-aligned text leaves more whitespace below the
 * baseline than above). A small upward translate brings the visual
 * centre back to the geometric centre.
 *
 * The lift scales sub-linearly with size — at 12 px even 0.5 px reads
 * as a clear visual shift, at 24 px we need ~1.25 px to look right.
 */
function liftFor(size: number): number {
  if (size <= 12) return 0.5;
  if (size <= 14) return 0.5;
  if (size <= 16) return 0.75;
  if (size <= 18) return 1;
  if (size <= 22) return 1;
  return 1.25;
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
  const lift = liftFor(size);

  const toneClasses =
    tone === 'light'
      ? 'bg-white/90 text-black/85'
      : 'bg-[color:var(--color-text-muted)] text-[color:var(--color-bg)]';

  return (
    <span
      className={
        'inline-flex shrink-0 select-none items-center justify-center font-bold uppercase ' +
        'rounded-[3px] leading-none tracking-tight overflow-hidden ' +
        toneClasses +
        (className ? ' ' + className : '')
      }
      style={{
        width: size,
        height: size,
        fontSize,
        // No translate on the OUTER box — lifting the whole element
        // visibly desyncs it from sibling text (e.g. inside a flex
        // row with `items-center` it ends up sitting above the
        // baseline). The inner span lift handles optical centring
        // without disturbing the outer element's flow.
        padding: 0,
        lineHeight: 1,
      }}
      aria-label={label}
      title={label}
    >
      <span
        aria-hidden
        // `block` strips the inline-leading trick, `lineHeight: 1`
        // collapses the descender room, and the upward translate
        // pulls the caps-aligned glyph up to the geometric centre.
        // Combined this puts the "E" exactly in the middle of the
        // box at every supported size (12 / 14 / 18 / 20 / 24 px).
        style={{
          display: 'block',
          lineHeight: 1,
          transform: `translateY(-${lift}px)`,
        }}
      >
        E
      </span>
    </span>
  );
}
