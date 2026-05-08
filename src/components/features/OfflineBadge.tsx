/**
 * Visual indicator for offline-saved state of a track. Renders one of:
 *
 *   1. Nothing — when the track is neither saved nor downloading.
 *   2. Animated progress ring — while the download is in flight.
 *   3. Static green checkmark-in-circle — when the download is
 *      complete and the audio is in IndexedDB.
 *
 * The ring animates its arc via `motion/react` using the normalised
 * `progress` value (0→1) from the zustand mirror of the download job.
 * On completion the ring morphs into a checkmark with a quick spring
 * transition so the state change feels physical rather than binary.
 *
 * Usage:
 *   <OfflineBadge trackId={track.id} size={16} />
 */
import { AnimatePresence, motion } from 'motion/react';
import { useIsTrackSavedOffline, useTrackDownloadJob } from '@/hooks/useOfflineActions';
import { useT } from '@/i18n';

interface OfflineBadgeProps {
  trackId: string;
  /** Pixel size of the badge (width = height). Defaults to 16. */
  size?: number;
  className?: string;
}

export function OfflineBadge({ trackId, size = 16, className = '' }: OfflineBadgeProps) {
  const t = useT();
  const saved = useIsTrackSavedOffline(trackId);
  const job = useTrackDownloadJob(trackId);

  const isDownloading = job && (job.status === 'queued' || job.status === 'downloading');
  const show = saved || isDownloading;
  if (!show) return null;

  const progress = isDownloading ? (job.progress ?? 0) : 1;
  const radius = (size - 3) / 2;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference * (1 - progress);

  return (
    <AnimatePresence mode="wait">
      {isDownloading ? (
        <motion.span
          key="ring"
          initial={{ opacity: 0, scale: 0.7 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.7 }}
          transition={{ type: 'spring', stiffness: 400, damping: 20 }}
          className={`inline-flex items-center justify-center shrink-0 ${className}`}
          style={{ width: size, height: size }}
        >
          <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
            {/* Background track */}
            <circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
              className="text-muted-foreground/30"
            />
            {/* Animated progress arc */}
            <motion.circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke="var(--color-accent)"
              strokeWidth={1.5}
              strokeLinecap="round"
              strokeDasharray={circumference}
              animate={{ strokeDashoffset }}
              transition={{ duration: 0.35, ease: 'easeOut' }}
              style={{
                transformOrigin: 'center',
                transform: 'rotate(-90deg)',
              }}
            />
          </svg>
        </motion.span>
      ) : (
        <motion.span
          key="check"
          initial={{ opacity: 0, scale: 0.5 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.5 }}
          transition={{ type: 'spring', stiffness: 500, damping: 25 }}
          className={`inline-flex items-center justify-center shrink-0 ${className}`}
          style={{ width: size, height: size }}
          aria-label={t('common.savedOffline')}
        >
          <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
            <circle cx="8" cy="8" r="7" fill="var(--color-accent)" fillOpacity="0.15" />
            <path
              d="M5 8.5L7 10.5L11 6.5"
              stroke="var(--color-accent)"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </motion.span>
      )}
    </AnimatePresence>
  );
}
