/**
 * Hero-area button that toggles offline-save for an album or playlist.
 * Sits next to the ❤ like button in the album / playlist hero.
 *
 * States:
 *   - idle (not saved, not downloading): shows ↓ arrow icon.
 *   - downloading: shows animated progress ring + percentage.
 *   - saved + complete: shows checkmark-in-circle (accent color).
 *   - saved + missing tracks: checkmark + tiny corner badge with the
 *     missing count, AND a sibling "Download N missing" pill so the
 *     user can resume / fill in newly-added tracks without
 *     clobbering everything else.
 *
 * Tapping while downloading cancels the download.
 * Tapping while saved opens a confirmation sheet asking whether to
 * delete tracks too or keep them on device.
 */
import { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowDownToLine, Check, X, Download } from 'lucide-react';
import {
  useIsAlbumSavedOffline,
  useIsPlaylistSavedOffline,
  useAlbumDownloadJob,
  usePlaylistDownloadJob,
  useOfflineActions,
  useMissingOfflineTrackCount,
} from '@/hooks/useOfflineActions';
import type { Album, Playlist, Track } from '@/types';
import { useT } from '@/i18n';
import { UnsaveConfirmDialog, type UnsaveChoice } from './UnsaveConfirmDialog';

interface AlbumOfflineButtonProps {
  album: Album;
  tracks: Track[];
}

export function AlbumOfflineButton({ album, tracks }: AlbumOfflineButtonProps) {
  const t = useT();
  const saved = useIsAlbumSavedOffline(album.id);
  const job = useAlbumDownloadJob(album.id);
  const {
    saveAlbum, unsaveAlbum, unsaveAlbumKeepTracks, resumeAlbum, cancelAlbum,
  } = useOfflineActions();

  // Stable id list keyed off the actual track array so
  // `useMissingOfflineTrackCount` only re-runs when the upstream
  // album really changes (the same identical track list across
  // re-renders should not invalidate the memoised count).
  const trackIds = useMemo(() => tracks.map((tr) => tr.id), [tracks]);
  const missingCount = useMissingOfflineTrackCount(saved ? trackIds : null);

  const [confirmOpen, setConfirmOpen] = useState(false);

  const isDownloading = job && (job.status === 'queued' || job.status === 'downloading');
  const progress = isDownloading ? Math.round((job.progress ?? 0) * 100) : 0;

  const handleClick = () => {
    if (isDownloading) {
      cancelAlbum(album.id);
    } else if (saved) {
      // Don't blow away the user's audio blobs without asking — the
      // confirmation dialog handles the actual destructive action.
      setConfirmOpen(true);
    } else {
      void saveAlbum(album, tracks);
    }
  };

  const handleConfirm = async (choice: UnsaveChoice) => {
    if (choice === 'deleteAll') {
      await unsaveAlbum(album.id);
    } else {
      await unsaveAlbumKeepTracks(album.id);
    }
  };

  const handleResume = () => {
    void resumeAlbum(album, tracks);
  };

  return (
    <>
      <OfflineActionShell
        saved={saved}
        isDownloading={!!isDownloading}
        progress={progress}
        missingCount={missingCount}
        onMainClick={handleClick}
        onResumeClick={handleResume}
        ariaLabel={
          isDownloading
            ? t('offline.cancelDownload')
            : saved
              ? t('offline.removeFromDevice')
              : t('offline.saveToDevice')
        }
      />
      <UnsaveConfirmDialog
        open={confirmOpen}
        target="album"
        itemTitle={album.title}
        onConfirm={handleConfirm}
        onClose={() => setConfirmOpen(false)}
      />
    </>
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
  const {
    savePlaylist, unsavePlaylist, unsavePlaylistKeepTracks, resumePlaylist, cancelPlaylist,
  } = useOfflineActions();

  const trackIds = useMemo(() => tracks.map((tr) => tr.id), [tracks]);
  const missingCount = useMissingOfflineTrackCount(saved ? trackIds : null);

  const [confirmOpen, setConfirmOpen] = useState(false);

  const isDownloading = job && (job.status === 'queued' || job.status === 'downloading');
  const progress = isDownloading ? Math.round((job.progress ?? 0) * 100) : 0;

  const handleClick = () => {
    if (isDownloading) {
      cancelPlaylist(playlist.id);
    } else if (saved) {
      setConfirmOpen(true);
    } else {
      void savePlaylist(playlist, tracks);
    }
  };

  const handleConfirm = async (choice: UnsaveChoice) => {
    if (choice === 'deleteAll') {
      await unsavePlaylist(playlist.id);
    } else {
      await unsavePlaylistKeepTracks(playlist.id);
    }
  };

  const handleResume = () => {
    void resumePlaylist(playlist, tracks);
  };

  return (
    <>
      <OfflineActionShell
        saved={saved}
        isDownloading={!!isDownloading}
        progress={progress}
        missingCount={missingCount}
        onMainClick={handleClick}
        onResumeClick={handleResume}
        ariaLabel={
          isDownloading
            ? t('offline.cancelDownload')
            : saved
              ? t('offline.removeFromDevice')
              : t('offline.saveToDevice')
        }
      />
      <UnsaveConfirmDialog
        open={confirmOpen}
        target="playlist"
        itemTitle={playlist.name}
        onConfirm={handleConfirm}
        onClose={() => setConfirmOpen(false)}
      />
    </>
  );
}

// ───────────────────── internal shared UI ─────────────────────

interface OfflineActionShellProps {
  saved: boolean;
  isDownloading: boolean;
  progress: number;
  /** `null` while the offline cache is still hydrating, `0` when
   *  everything is on disk, positive when some tracks are missing
   *  and the resume pill should appear. */
  missingCount: number | null;
  onMainClick: () => void;
  onResumeClick: () => void;
  ariaLabel: string;
}

/**
 * Layout shell that pairs the circular save / cancel button with the
 * optional "Download N missing" resume pill so callers don't have to
 * worry about flex wrapping in their hero. Pill animates in/out
 * independently of the circle so the user perceives the resume
 * affordance as a temporary, dismissable thing — not a permanent
 * fixture.
 */
function OfflineActionShell({
  saved,
  isDownloading,
  progress,
  missingCount,
  onMainClick,
  onResumeClick,
  ariaLabel,
}: OfflineActionShellProps) {
  // The pill only makes sense when the album/playlist is saved AND
  // not currently downloading AND we know about at least one
  // missing track. In every other state the user already has a
  // clearer affordance (cancel, save, etc.) on the circular button.
  const showResume = saved && !isDownloading && (missingCount ?? 0) > 0;
  return (
    <div className="inline-flex items-center gap-2">
      <OfflineCircleButton
        saved={saved}
        isDownloading={isDownloading}
        progress={progress}
        missingCount={missingCount ?? 0}
        onClick={onMainClick}
        ariaLabel={ariaLabel}
      />
      <AnimatePresence initial={false}>
        {showResume && (
          <ResumeMissingPill
            key="resume"
            count={missingCount ?? 0}
            onClick={onResumeClick}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

interface OfflineCircleButtonProps {
  saved: boolean;
  isDownloading: boolean;
  progress: number;
  missingCount: number;
  onClick: () => void;
  ariaLabel: string;
}

function OfflineCircleButton({
  saved, isDownloading, progress, missingCount, onClick, ariaLabel,
}: OfflineCircleButtonProps) {
  const radius = 13;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference * (1 - progress / 100);
  const hasMissing = saved && !isDownloading && missingCount > 0;

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

      {/* Tiny "missing tracks" badge in the upper right corner — the
          pill alongside is the primary affordance, but the badge gives
          the user a second visual anchor in case the pill scrolls out
          of view (it can be wider than the album hero on small
          screens). */}
      {hasMissing && (
        <motion.span
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 500, damping: 22 }}
          className="absolute -right-1 -top-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--color-accent)] px-1 text-[10px] font-semibold leading-none text-white shadow-sm"
        >
          {missingCount}
        </motion.span>
      )}
    </motion.button>
  );
}

interface ResumeMissingPillProps {
  count: number;
  onClick: () => void;
}

function ResumeMissingPill({ count, onClick }: ResumeMissingPillProps) {
  const t = useT();
  return (
    <motion.button
      type="button"
      onClick={onClick}
      whileTap={{ scale: 0.96 }}
      initial={{ opacity: 0, x: -6, scale: 0.92 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: -6, scale: 0.92 }}
      transition={{ type: 'spring', stiffness: 380, damping: 28 }}
      className="inline-flex h-9 items-center gap-1.5 rounded-full border border-[var(--color-accent)]/30 bg-[var(--color-accent)]/10 px-3 text-xs font-medium text-[var(--color-accent)] transition-colors hover:bg-[var(--color-accent)]/15"
      title={t('offline.resumeDownload')}
    >
      <Download size={14} />
      <span>{t('offline.resumeDownloadCount', { count })}</span>
    </motion.button>
  );
}
