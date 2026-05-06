/**
 * Hero-area button that toggles offline-save for an album or playlist.
 * Sits next to the ❤ like button in the album / playlist hero.
 *
 * States:
 *   - idle (not saved, not downloading): shows ↓ arrow icon.
 *   - downloading: shows animated progress ring + percentage.
 *   - saved: shows checkmark-in-circle (green accent).
 *
 * Tapping while downloading cancels the download.
 * Tapping while saved removes from device.
 */
import { motion, AnimatePresence } from 'motion/react';
import { ArrowDownToLine, Check, X } from 'lucide-react';
import {
  useIsAlbumSavedOffline,
  useIsPlaylistSavedOffline,
  useAlbumDownloadJob,
  usePlaylistDownloadJob,
  useOfflineActions,
} from '@/hooks/useOfflineActions';
import type { Album, Playlist, Track } from '@/types';
import { useT } from '@/i18n';

interface AlbumOfflineButtonProps {
  album: Album;
  tracks: Track[];
}

export function AlbumOfflineButton({ album, tracks }: AlbumOfflineButtonProps) {
  const t = useT();
  const saved = useIsAlbumSavedOffline(album.id);
  const job = useAlbumDownloadJob(album.id);
  const { saveAlbum, unsaveAlbum, cancelAlbum } = useOfflineActions();

  const isDownloading = job && (job.status === 'queued' || job.status === 'downloading');
  const progress = isDownloading ? Math.round((job.progress ?? 0) * 100) : 0;

  const handleClick = () => {
    if (isDownloading) {
      cancelAlbum(album.id);
    } else if (saved) {
      void unsaveAlbum(album.id);
    } else {
      void saveAlbum(album, tracks);
    }
  };

  return (
    <OfflineCircleButton
      saved={saved}
      isDownloading={!!isDownloading}
      progress={progress}
      onClick={handleClick}
      ariaLabel={
        isDownloading
          ? t('offline.cancelDownload')
          : saved
            ? t('offline.removeFromDevice')
            : t('offline.saveToDevice')
      }
    />
  );
}

interface PlaylistOfflineButtonProps {
  playlist: Playlist;
  tracks: Track[];
}

export function PlaylistOfflineButton({ playlist, tracks }: PlaylistOfflineButtonProps) {
  const t = useT();
  const saved = useIsPlaylistSavedOffline(playlist.id);
  const job = usePlaylistDownloadJob(playlist.id);
  const { savePlaylist, unsavePlaylist, cancelPlaylist } = useOfflineActions();

  const isDownloading = job && (job.status === 'queued' || job.status === 'downloading');
  const progress = isDownloading ? Math.round((job.progress ?? 0) * 100) : 0;

  const handleClick = () => {
    if (isDownloading) {
      cancelPlaylist(playlist.id);
    } else if (saved) {
      void unsavePlaylist(playlist.id);
    } else {
      void savePlaylist(playlist, tracks);
    }
  };

  return (
    <OfflineCircleButton
      saved={saved}
      isDownloading={!!isDownloading}
      progress={progress}
      onClick={handleClick}
      ariaLabel={
        isDownloading
          ? t('offline.cancelDownload')
          : saved
            ? t('offline.removeFromDevice')
            : t('offline.saveToDevice')
      }
    />
  );
}

// ───────────────────── internal shared UI ─────────────────────

interface OfflineCircleButtonProps {
  saved: boolean;
  isDownloading: boolean;
  progress: number;
  onClick: () => void;
  ariaLabel: string;
}

function OfflineCircleButton({ saved, isDownloading, progress, onClick, ariaLabel }: OfflineCircleButtonProps) {
  const radius = 13;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference * (1 - progress / 100);

  return (
    <motion.button
      type="button"
      onClick={onClick}
      whileTap={{ scale: 0.82 }}
      transition={{ type: 'spring', stiffness: 400, damping: 17 }}
      className={`relative inline-flex h-9 w-9 items-center justify-center rounded-full border transition-all active:scale-90 ${
        saved
          ? 'border-[var(--color-accent)]/30 bg-[var(--color-accent)]/15 text-[var(--color-accent)]'
          : isDownloading
            ? 'border-[var(--color-accent)]/30 bg-[var(--color-accent)]/10 text-[var(--color-accent)]'
            : 'border-border text-muted-foreground hover:text-foreground hover:bg-secondary'
      }`}
      aria-label={ariaLabel}
      title={ariaLabel}
    >
      {/* SVG ring rendered underneath the icon when downloading */}
      {isDownloading && (
        <svg
          className="absolute inset-0"
          width={36}
          height={36}
          viewBox="0 0 36 36"
        >
          <circle
            cx="18" cy="18" r={radius}
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className="opacity-20"
          />
          <motion.circle
            cx="18" cy="18" r={radius}
            fill="none"
            stroke="var(--color-accent)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeDasharray={circumference}
            animate={{ strokeDashoffset }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
            style={{ transformOrigin: 'center', transform: 'rotate(-90deg)' }}
          />
        </svg>
      )}

      <AnimatePresence mode="wait">
        {isDownloading ? (
          <motion.span
            key="cancel"
            initial={{ opacity: 0, scale: 0.5 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.5 }}
            transition={{ duration: 0.15 }}
          >
            <X size={16} />
          </motion.span>
        ) : saved ? (
          <motion.span
            key="saved"
            initial={{ opacity: 0, scale: 0.5 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.5 }}
            transition={{ type: 'spring', stiffness: 500, damping: 25 }}
          >
            <Check size={16} />
          </motion.span>
        ) : (
          <motion.span
            key="download"
            initial={{ opacity: 0, scale: 0.5 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.5 }}
            transition={{ duration: 0.15 }}
          >
            <ArrowDownToLine size={16} />
          </motion.span>
        )}
      </AnimatePresence>
    </motion.button>
  );
}
