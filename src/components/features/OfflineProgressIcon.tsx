/**
 * Compact progress indicator for the kebab-menu / player offline-save
 * actions.
 *
 * Why not a `<Loader2 className="animate-spin" />`?
 * -------------------------------------------------
 * The previous shape rendered an abstract spinning spinner while a
 * track download was in flight. The animation looks identical at
 * 1% and at 99% download progress, so the user reported they
 * "не понимали, загрузилось или нет — крутится и всё". The
 * underlying download manager already publishes a real
 * `job.progress` value in [0..1] (see
 * `src/lib/offline/downloads.ts`), and the album / playlist hero
 * button already renders a real progress ring (see
 * `OfflineActionButton.tsx`). This component lifts that ring into a
 * shape suitable for the smaller (14 px) kebab / player-popover
 * icons so every download surface uses the same affordance.
 *
 * Behaviour
 * ---------
 *   - Renders an SVG circle with a stroked progress arc that
 *     sweeps from 12 o'clock clockwise as `progress` rises from
 *     0 to 1.
 *   - When the menu item is wide enough (any `size >= 14`), shows
 *     a crisp percentage label inside the ring. We deliberately
 *     keep the digit centred and slightly smaller than the ring
 *     diameter so the layout doesn't shift when the percentage
 *     ticks over from 9% → 10% → 99% → 100%.
 *   - Indeterminate mode (`progress` undefined / null) — falls
 *     back to a rotating arc the user can still distinguish from
 *     a stalled spinner. We use this when `Content-Length` is
 *     missing and the resolver can't compute a percentage; the
 *     rotation is a `motion/react` infinite loop rather than the
 *     CSS `animate-spin` because it pairs better with the
 *     spring transitions on the surrounding popover.
 *
 * Performance
 * -----------
 * `motion/react`'s `animate` prop on the dasharray-shifted circle
 * is GPU-accelerated and re-renders only when `progress` changes;
 * the parent kebab passes a memoised job object so we don't
 * thrash re-renders during a long FLAC download.
 */
import { motion } from 'motion/react';
import { useT } from '@/i18n';

interface OfflineProgressIconProps {
  /** Download progress in [0..1]. Pass `undefined` / `null` for
   *  indeterminate mode (rotating arc). */
  progress?: number | null;
  /** Pixel size of the ring (width = height). Defaults to 14 to
   *  match the surrounding `lucide-react` icons in kebab menus. */
  size?: number;
  /** Show the integer percentage label inside the ring. Default
   *  is true for sizes ≥ 14. Set to false to render a bare ring
   *  on tighter surfaces. */
  showLabel?: boolean;
  className?: string;
}

export function OfflineProgressIcon({
  progress,
  size = 14,
  showLabel,
  className = '',
}: OfflineProgressIconProps) {
  const t = useT();
  const isIndeterminate =
    progress === undefined || progress === null || Number.isNaN(progress);
  const clamped = isIndeterminate ? 0 : Math.max(0, Math.min(1, progress));
  const percent = Math.round(clamped * 100);
  const radius = (size - 2) / 2;
  const circumference = 2 * Math.PI * radius;

  // Indeterminate ring: a 25%-of-the-circle arc that rotates around
  // the centre. Solid percentage progress overrides this with a
  // stroke-dashoffset that maps directly to the job progress.
  const indeterminateDasharray = `${circumference * 0.25} ${circumference * 0.75}`;
  const determinateDashoffset = circumference * (1 - clamped);

  // Default label visibility — show when the ring is large enough
  // for digits to fit without overflowing the kebab row.
  const renderLabel = showLabel ?? size >= 14;

  return (
    <span
      className={`relative inline-flex items-center justify-center shrink-0 ${className}`}
      style={{ width: size, height: size }}
      aria-label={isIndeterminate ? t('offline.downloading') : t('offline.downloadingPercent', { percent })}
      role="img"
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        // Rotate the SVG so the arc sweeps from 12 o'clock instead
        // of the SVG default (3 o'clock). `transform-origin: center`
        // is implicit on root SVG elements.
        style={{ transform: 'rotate(-90deg)' }}
      >
        {/* Background track. Half-transparent so it doesn't compete
            with the menu-item label colour. */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          className="opacity-25"
        />
        {isIndeterminate ? (
          <motion.circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeDasharray={indeterminateDasharray}
            animate={{ rotate: 360 }}
            transition={{
              duration: 1.2,
              ease: 'linear',
              repeat: Infinity,
            }}
            style={{ transformOrigin: 'center' }}
          />
        ) : (
          <motion.circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeDasharray={circumference}
            animate={{ strokeDashoffset: determinateDashoffset }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
          />
        )}
      </svg>
      {renderLabel && !isIndeterminate && (
        <span
          // The label sits over the ring in absolute position so the
          // surrounding flex layout (kebab MenuItem) doesn't widen
          // when the percentage scales from 1 to 3 digits. The font
          // is `tabular-nums` so 1, 10, 100 line up at the same
          // visual width — keeps the kebab row from twitching.
          className="absolute inset-0 flex items-center justify-center font-medium tabular-nums leading-none text-[var(--color-accent)]"
          style={{
            // Roughly half the ring diameter — sized so 100 fits
            // without bleeding outside the ring at size=14.
            fontSize: Math.max(7, Math.round(size * 0.45)),
          }}
        >
          {percent}
        </span>
      )}
    </span>
  );
}
