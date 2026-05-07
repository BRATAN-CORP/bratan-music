/**
 * Compact download-progress overlay rendered on top of an album /
 * playlist card while the entity is being saved offline.
 *
 * Why this exists
 * ---------------
 * `OfflineActionButton` already renders a progress ring on the
 * detail-page hero, and `OfflineProgressIcon` does the same for the
 * 14 px kebab affordance. But the user reported that the small
 * tile in lists / grids ("когда скачиваешь альбом или плейлист, то
 * загрузка не показывается на иконке у самого альбома или плейлиста
 * динамически, как у треков") had no live indication that a
 * download was in flight — even though the underlying download
 * manager publishes the same `job.progress` value the hero button
 * consumes. From the list view the user couldn't tell whether their
 * tap actually started the save or not.
 *
 * Behaviour
 * ---------
 *   - `kind` selects the right `useXxxDownloadJob(id)` subscription
 *     so a single component handles both album and playlist
 *     surfaces without each card hand-rolling the hooks plumbing.
 *   - When no job is active or the job has reached a terminal state
 *     (`completed` / `failed` / `cancelled`) the component renders
 *     nothing — important: `null`, not an empty wrapper, so we
 *     don't introduce stacking-context regressions on cards that
 *     already use `position: relative` for hover overlays.
 *   - When a job is queued / downloading it paints a translucent
 *     full-tile overlay with a centred progress ring + percentage.
 *     The overlay is `pointer-events-none` so the parent `<Link>`
 *     remains clickable (cancel still happens through the existing
 *     hero / kebab affordances — duplicating that here would
 *     conflict with navigation on tap).
 *
 * Sizing
 * ------
 * Defaults work for the standard album / playlist tile. Pass
 * `compact` for the playlist row variant where the tile is only
 * 48 px tall and a full-tile overlay would obscure the title.
 */
import { motion } from 'motion/react';
import {
  useAlbumDownloadJob,
  usePlaylistDownloadJob,
} from '@/hooks/useOfflineActions';
import type { DownloadJob } from '@/lib/offline/types';

interface CardDownloadOverlayProps {
  kind: 'album' | 'playlist';
  id: string;
  /** Compact mode renders a small progress ring corner badge instead
   *  of a full-tile overlay. Used on horizontal playlist rows where
   *  the tile is only ~48 px tall. */
  compact?: boolean;
}

export function CardDownloadOverlay({
  kind,
  id,
  compact = false,
}: CardDownloadOverlayProps) {
  // Always call both hooks unconditionally so the hook-call order
  // stays stable across renders. The unused subscription is a no-op
  // (selector returns `null` when there is no job for that id).
  const albumJob = useAlbumDownloadJob(kind === 'album' ? id : '');
  const playlistJob = usePlaylistDownloadJob(kind === 'playlist' ? id : '');
  const job = kind === 'album' ? albumJob : playlistJob;

  if (!isActiveJob(job)) return null;

  const progress = clamp01(job.progress ?? 0);
  if (compact) return <CompactBadge progress={progress} />;
  return <FullTileOverlay progress={progress} />;
}

function isActiveJob(job: DownloadJob | null): job is DownloadJob {
  if (!job) return false;
  return job.status === 'queued' || job.status === 'downloading';
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

interface OverlayInner {
  progress: number;
}

function FullTileOverlay({ progress }: OverlayInner) {
  // Ring sized for the standard ~48 × 48 px hit area used on detail
  // pages — large enough to read the percentage but small enough
  // not to dominate a 160 px album tile.
  const size = 56;
  const radius = (size - 6) / 2;
  const circumference = 2 * Math.PI * radius;
  const dashoffset = circumference * (1 - progress);
  const percent = Math.round(progress * 100);

  return (
    <div
      className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/55 rounded-[var(--radius-md)]"
      aria-hidden
    >
      <div
        className="relative flex items-center justify-center"
        style={{ width: size, height: size }}
      >
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          style={{ transform: 'rotate(-90deg)' }}
        >
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="white"
            strokeOpacity={0.25}
            strokeWidth={3}
          />
          <motion.circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="var(--color-accent)"
            strokeWidth={3}
            strokeLinecap="round"
            strokeDasharray={circumference}
            animate={{ strokeDashoffset: dashoffset }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
          />
        </svg>
        <span className="absolute text-xs font-semibold text-white tabular-nums">
          {percent}%
        </span>
      </div>
    </div>
  );
}

function CompactBadge({ progress }: OverlayInner) {
  const size = 28;
  const radius = (size - 4) / 2;
  const circumference = 2 * Math.PI * radius;
  const dashoffset = circumference * (1 - progress);
  const percent = Math.round(progress * 100);

  return (
    <div
      className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/45 rounded-[var(--radius-sm)]"
      aria-hidden
    >
      <div
        className="relative flex items-center justify-center"
        style={{ width: size, height: size }}
      >
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          style={{ transform: 'rotate(-90deg)' }}
        >
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="white"
            strokeOpacity={0.3}
            strokeWidth={2}
          />
          <motion.circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="var(--color-accent)"
            strokeWidth={2}
            strokeLinecap="round"
            strokeDasharray={circumference}
            animate={{ strokeDashoffset: dashoffset }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
          />
        </svg>
        <span className="absolute text-[9px] font-semibold text-white tabular-nums leading-none">
          {percent}
        </span>
      </div>
    </div>
  );
}
