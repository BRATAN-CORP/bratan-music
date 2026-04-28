import { useRef, useState } from 'react';
import { Download, Heart, ListOrdered, ListPlus, MoreHorizontal, Pause, Play, Trash2, Upload } from 'lucide-react';
import { motion } from 'motion/react';
import type { Track } from '@/types';
import { Button } from '@/components/ui/Button';
import { PopoverMenu } from '@/components/ui/PopoverMenu';
import { useToggleLike, useRemoveTrackFromPlaylist } from '@/hooks/useLibrary';
import { useAuthStore } from '@/store/auth';
import { usePlayerStore } from '@/store/player';
import { useTrackPlayback } from '@/hooks/usePlaybackSync';
import { useCoarsePointer } from '@/hooks/useCoarsePointer';
import { downloadTrack } from '@/lib/trackActions';
import { TrackOverrideModal } from '@/components/features/TrackOverrideModal';
import { AddToPlaylistDialog } from '@/components/features/AddToPlaylistDialog';

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
  const isAuthed = useAuthStore((s) => Boolean(s.user));
  const { isLiked, toggle } = useToggleLike();
  const liked = isAuthed && isLiked(track.id);
  const coarse = useCoarsePointer();

  const [menuOpen, setMenuOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [addToPlaylistOpen, setAddToPlaylistOpen] = useState(false);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  const removeFromPlaylist = useRemoveTrackFromPlaylist();
  const addToQueue = usePlayerStore((s) => s.addToQueue);
  const playNext = usePlayerStore((s) => s.playNext);
  // True when *this* row is the currently-loaded track. Used to swap
  // the cover-overlay icon (Play↔Pause) and to route clicks through
  // togglePlay() instead of restarting the track from zero. Resuming
  // from a paused-but-active state is the expected behaviour everywhere
  // in the app, not just on the active row, so we use `isActive` (not
  // `isActivePlaying`) as the toggle gate.
  const { isActive, isActivePlaying, playOrToggle } = useTrackPlayback(track.id);

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

  const handleRemove = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!playlistId) return;
    setMenuOpen(false);
    removeFromPlaylist.mutate({ playlistId, trackId: track.id });
  };

  const handleAddToPlaylist = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setMenuOpen(false);
    setAddToPlaylistOpen(true);
  };

  const handleAddToQueue = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setMenuOpen(false);
    addToQueue({
      id: track.id,
      title: track.title,
      artist: track.artist,
      artistId: track.artistId,
      coverUrl: track.coverUrl,
      duration: track.duration,
    });
  };

  const handlePlayNext = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setMenuOpen(false);
    playNext({
      id: track.id,
      title: track.title,
      artist: track.artist,
      artistId: track.artistId,
      coverUrl: track.coverUrl,
      duration: track.duration,
    });
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6, transition: { duration: 0.18 } }}
      transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1], delay: Math.min((index ?? 0) * 0.025, 0.4) }}
      className="group flex cursor-pointer items-center gap-3 border-b border-border px-3 py-2 last:border-b-0 transition-colors hover:bg-secondary"
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
        <p className="truncate text-xs text-muted-foreground">{track.artist}</p>
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
          aria-label={liked ? 'Убрать лайк' : 'Лайк'}
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
              aria-label="Скачать"
              title="Скачать"
            >
              <Download size={14} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={handleOpenOverride}
              aria-label="Загрузить свою версию"
              title="Загрузить свою версию"
            >
              <Upload size={14} />
            </Button>
          </>
        )}
        <Button
          ref={menuTriggerRef}
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={(e) => { e.stopPropagation(); setMenuOpen((v) => !v); }}
          aria-label="Ещё"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
        >
          <MoreHorizontal size={14} />
        </Button>
        <PopoverMenu
          open={menuOpen}
          onClose={() => setMenuOpen(false)}
          triggerRef={menuTriggerRef}
          anchor="bottom"
          align="end"
          width={208}
        >
                {isAuthed && (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={handleAddToPlaylist}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-secondary"
                  >
                    <ListPlus size={14} />
                    Добавить в плейлист
                  </button>
                )}
                <button
                  type="button"
                  role="menuitem"
                  onClick={handlePlayNext}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-secondary"
                >
                  <ListOrdered size={14} />
                  Воспроизвести следующим
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={handleAddToQueue}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-secondary"
                >
                  <ListOrdered size={14} />
                  Добавить в очередь
                </button>
                {playlistId && !hideRemoveMenu && (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={handleRemove}
                    disabled={removeFromPlaylist.isPending}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-[var(--color-danger)] transition-colors hover:bg-[var(--color-danger-muted)] disabled:opacity-60"
                  >
                    <Trash2 size={14} />
                    Удалить из плейлиста
                  </button>
                )}
        </PopoverMenu>
      </div>

      <TrackOverrideModal
        open={overrideOpen}
        onClose={() => setOverrideOpen(false)}
        trackId={track.id}
        trackTitle={`${track.artist} — ${track.title}`}
      />

      <AddToPlaylistDialog
        open={addToPlaylistOpen}
        onClose={() => setAddToPlaylistOpen(false)}
        track={track}
      />
    </motion.div>
  );
}
