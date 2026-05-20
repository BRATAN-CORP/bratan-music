/**
 * Small "E" badge for tracks / albums / playlists the source provider
 * tags as Explicit.
 *
 * Visual: solid muted square with the letter "E" **cut out** (transparent)
 * so the page background shows through. This matches Tidal / Spotify /
 * Apple Music badge design — a boolean subtract operation, not a filled
 * glyph on a coloured rectangle.
 *
 * Implementation: SVG `<mask>` — the rect fills white (opaque), the "E"
 * path fills black (transparent). The visible fill colour is applied to
 * a single full-size rect masked by this shape.
 */
import { useT } from '@/i18n';

export type ExplicitBadgeTone = 'auto' | 'light';

interface ExplicitBadgeProps {
  explicit: boolean | undefined | null;
  size?: number;
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

  // Fill colour: theme-aware muted for default, white for light surfaces
  const fill =
    tone === 'light'
      ? 'rgba(255,255,255,0.85)'
      : 'var(--color-text-muted)';

  // Unique mask id per instance is NOT needed because SVG <mask> with
  // the same id within different inline SVGs are scoped to their own
  // document fragment in modern browsers. But to be safe across React
  // portals we use a static id (all instances render the same shape).
  return (
    <span
      className={
        'inline-flex shrink-0 select-none items-center justify-center align-middle' +
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
        <mask id="e-cut">
          {/* White = visible area (the square body) */}
          <rect x="0" y="0" width="10" height="10" rx="1.6" ry="1.6" fill="white" />
          {/* Black = cut-out area (the letter E — becomes transparent) */}
          <path
            fill="black"
            d="M2.8 2.2 H7.2 V3.4 H4.0 V4.4 H6.8 V5.6 H4.0 V6.6 H7.2 V7.8 H2.8 Z"
          />
        </mask>
        {/* Single filled rect, masked so the E is punched out */}
        <rect
          x="0" y="0" width="10" height="10"
          rx="1.6" ry="1.6"
          style={{ fill }}
          mask="url(#e-cut)"
        />
      </svg>
    </span>
  );
}
