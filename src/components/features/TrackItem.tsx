import { useEffect, useRef, useState } from 'react';
import { Download, Heart, MoreHorizontal, Play, Trash2, Upload } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import type { Track } from '@/types';
import { Button } from '@/components/ui/Button';
import { useToggleLike, useRemoveTrackFromPlaylist } from '@/hooks/useLibrary';
import { useAuthStore } from '@/store/auth';
import { useCoarsePointer } from '@/hooks/useCoarsePointer';
import { downloadTrack } from '@/lib/trackActions';
import { TrackOverrideModal } from '@/components/features/TrackOverrideModal';

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
  const menuRef = useRef<HTMLDivElement>(null);
  const removeFromPlaylist = useRemoveTrackFromPlaylist();

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

  useEffect(() => {
    if (!menuOpen) return;
    const onClick = (e: Event) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('touchstart', onClick);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('touchstart', onClick);
    };
  }, [menuOpen]);

  const handleRemove = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!playlistId) return;
    setMenuOpen(false);
    removeFromPlaylist.mutate({ playlistId, trackId: track.id });
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6, transition: { duration: 0.18 } }}
      transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1], delay: Math.min((index ?? 0) * 0.025, 0.4) }}
      className="group flex cursor-pointer items-center gap-3 border-b border-border px-3 py-2 last:border-b-0 transition-colors hover:bg-secondary"
      onClick={() => onPlay?.(track)}
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center">
        {track.coverUrl ? (
          <div className="relative h-10 w-10 overflow-hidden rounded-[var(--radius-sm)]">
            <img src={track.coverUrl} alt="" className="h-full w-full object-cover" />
            <div className="absolute inset-0 hidden items-center justify-center bg-[var(--color-media-overlay)] group-hover:flex">
              <Play size={14} fill="currentColor" className="text-[var(--color-text-on-accent)]" />
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
        {playlistId && !hideRemoveMenu ? (
          <div ref={menuRef} className="relative">
            <Button
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
            <AnimatePresence>
              {menuOpen && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.96, y: -4 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.96, y: -4 }}
                  transition={{ duration: 0.12, ease: [0.16, 1, 0.3, 1] }}
                  role="menu"
                  className="absolute right-0 top-8 z-20 w-52 overflow-hidden rounded-[var(--radius-md)] border border-border/60 bg-[var(--color-surface-elevated)]/80 shadow-[var(--shadow-xl)] backdrop-blur-xl ring-1 ring-white/5"
                >
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
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        ) : (
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={(e) => e.stopPropagation()} aria-label="Ещё">
            <MoreHorizontal size={14} />
          </Button>
        )}
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
