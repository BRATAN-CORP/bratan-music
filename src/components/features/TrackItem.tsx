import { useState } from 'react';
import { Download, Heart, Pause, Play, Upload } from 'lucide-react';
import { motion } from 'motion/react';
import type { Track } from '@/types';
import { Button } from '@/components/ui/Button';
import { useToggleLike } from '@/hooks/useLibrary';
import { useAuthStore } from '@/store/auth';
import { useTrackPlayback, useTrackHoverPrefetch } from '@/hooks/usePlaybackSync';
import { useCoarsePointer } from '@/hooks/useCoarsePointer';
import { downloadTrack } from '@/lib/trackActions';
import { TrackOverrideModal } from '@/components/features/TrackOverrideModal';
import { ArtistLinks } from '@/components/features/ArtistLinks';
import { TrackKebabMenu } from '@/components/features/TrackKebabMenu';
import { useT } from '@/i18n';

interface TrackItemProps {
  track: Track;
  index?: number;
  onPlay?: (track: Track) => void;
  /** When set, renders an action menu with "Удалить из плейлиста" */
  playlistId?: string;
  /** When true, the action menu is suppressed (the heart already removes the track). */
  hideRemoveMenu?: boolean;
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function TrackItem({ track, index, onPlay, playlistId, hideRemoveMenu }: TrackItemProps) {
  const t = useT();
  const isAuthed = useAuthStore((s) => Boolean(s.user));
  const { isLiked, toggle } = useToggleLike();
  const liked = isAuthed && isLiked(track.id);
  const coarse = useCoarsePointer();

  const [downloading, setDownloading] = useState(false);
  const [overrideOpen, setOverrideOpen] = useState(false);
  // Pinned-visible flag for the right-hand action row while the kebab
  // popover is open. The popover lives in a body portal so the row's
  // `md:focus-within` selector can't pick it up.
  const [menuOpen, setMenuOpen] = useState(false);
  // True when *this* row is the currently-loaded track. Used to swap
  // the cover-overlay icon (Play↔Pause) and to route clicks through
  // togglePlay() instead of restarting the track from zero. Resuming
  // from a paused-but-active state is the expected behaviour everywhere
  // in the app, not just on the active row, so we use `isActive` (not
  // `isActivePlaying`) as the toggle gate.
  const { isActive, isActivePlaying, playOrToggle } = useTrackPlayback(track.id);
  const hoverPrefetch = useTrackHoverPrefetch();

  const handleDownload = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (downloading) return;
    setDownloading(true);
    try {
      await downloadTrack(track);
    } catch (err) {
      console.error('[download]', err);
    } finally {
      setDownloading(false);
    }
  };

  const handleOpenOverride = (e: React.MouseEvent) => {
    e.stopPropagation();
    setOverrideOpen(true);
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6, transition: { duration: 0.18 } }}
      transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1], delay: Math.min((index ?? 0) * 0.025, 0.4) }}
      className="group flex cursor-pointer items-center gap-3 border-b border-border px-3 py-2 last:border-b-0 transition-colors hover:bg-secondary"
      onPointerEnter={() => hoverPrefetch(track)}
      onClick={() => {
        // Active row → toggle play/pause (whether currently playing or
        // paused). Inactive row → owner's onPlay callback wires up the
        // surrounding queue. This keeps the row consistent with the
        // mini-player and fullscreen play buttons everywhere else.
        if (isActive) {
          playOrToggle(track);
          return;
        }
        onPlay?.(track);
      }}
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center">
        {track.coverUrl ? (
          <div className="relative h-10 w-10 overflow-hidden rounded-[var(--radius-sm)]">
            <img src={track.coverUrl} alt="" className="h-full w-full object-cover" />
            {/* Hover overlay. Shows a Pause icon when this row is the
                currently-playing track (signals "click to stop"), or a
                Play icon when starting a new track. The active row
                also pre-shows the overlay (no hover required) on
                coarse-pointer / mobile so users can see playback state
                without hovering. */}
            <div
              className={
                'absolute inset-0 items-center justify-center bg-[var(--color-media-overlay)] ' +
                (isActive
                  ? 'flex opacity-100'
                  : 'hidden group-hover:flex')
              }
            >
              {isActivePlaying ? (
                <Pause size={14} fill="currentColor" className="text-[var(--color-text-on-accent)]" />
              ) : (
                <Play size={14} fill="currentColor" className="text-[var(--color-text-on-accent)]" />
              )}
            </div>
          </div>
        ) : (
          <span className="text-xs tabular-nums text-muted-foreground">
            {index !== undefined ? String(index + 1).padStart(2, '0') : '–'}
          </span>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{track.title}</p>
        <p className="truncate text-xs text-muted-foreground">
          <ArtistLinks
            artists={track.artists}
            fallbackName={track.artist}
            fallbackId={track.artistId}
            className="hover:text-foreground hover:underline"
          />
        </p>
      </div>

      <span className="hidden shrink-0 text-xs tabular-nums text-muted-foreground sm:block">
        {formatDuration(track.duration)}
      </span>

      <div className={"flex items-center gap-0.5 transition-opacity " + (liked || menuOpen ? 'opacity-100' : 'opacity-100 md:opacity-0 md:group-hover:opacity-100 md:focus-within:opacity-100')}>
        <Button
          variant="ghost"
          size="icon"
          className={"h-7 w-7 " + (liked ? 'opacity-100 text-[var(--color-accent)]' : '')}
          onClick={(e) => { e.stopPropagation(); if (isAuthed) toggle(track); }}
          aria-label={liked ? t('player.unlike') : t('player.like')}
        >
          <Heart size={14} fill={liked ? 'currentColor' : 'none'} />
        </Button>
        {isAuthed && !coarse && (
          <>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={handleDownload}
              disabled={downloading}
              aria-label={t('track.download')}
              title={t('track.download')}
            >
              <Download size={14} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={handleOpenOverride}
              aria-label={t('track.uploadOwn')}
              title={t('track.uploadOwn')}
            >
              <Upload size={14} />
            </Button>
          </>
        )}
        <TrackKebabMenu
          track={track}
          playlistId={playlistId}
          hideRemoveFromPlaylist={hideRemoveMenu}
          onOpenChange={setMenuOpen}
        />
      </div>

      <TrackOverrideModal
        open={overrideOpen}
        onClose={() => setOverrideOpen(false)}
        trackId={track.id}
        trackTitle={`${track.artist} — ${track.title}`}
      />
    </motion.div>
  );
}
