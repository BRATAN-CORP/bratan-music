import { useEffect, useRef, useState } from 'react';
import { Heart, MoreHorizontal, Play, Trash2, GripVertical } from 'lucide-react';
import { Reorder, useDragControls, motion, AnimatePresence, type PanInfo } from 'motion/react';
import type { Track } from '@/types';
import { Button } from '@/components/ui/Button';
import { useToggleLike, useRemoveTrackFromPlaylist } from '@/hooks/useLibrary';
import { useAuthStore } from '@/store/auth';

interface PlaylistTrackItemProps {
  track: Track;
  index: number;
  playlistId: string;
  reorderable: boolean;
  onPlay: (track: Track) => void;
  onReorderEnd?: () => void;
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function PlaylistTrackItem({
  track,
  index,
  playlistId,
  reorderable,
  onPlay,
  onReorderEnd,
}: PlaylistTrackItemProps) {
  const isAuthed = useAuthStore((s) => Boolean(s.user));
  const { isLiked, toggle } = useToggleLike();
  const liked = isAuthed && isLiked(track.id);
  const removeMutation = useRemoveTrackFromPlaylist();
  const dragControls = useDragControls();
  const [dragging, setDragging] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

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

  const handleRemove = () => {
    setMenuOpen(false);
    removeMutation.mutate({ playlistId, trackId: track.id });
  };

  const handleDragStart = (e: React.PointerEvent) => {
    e.preventDefault();
    setDragging(true);
    dragControls.start(e);
  };

  const handleDragEnd = (_e: PointerEvent | MouseEvent | TouchEvent, _info: PanInfo) => {
    setDragging(false);
    onReorderEnd?.();
  };

  const content = (
    <>
      {reorderable && (
        <button
          type="button"
          onPointerDown={handleDragStart}
          onClick={(e) => e.stopPropagation()}
          className="-ml-1 flex h-8 w-6 shrink-0 cursor-grab touch-none items-center justify-center text-muted-foreground transition-colors hover:text-foreground active:cursor-grabbing"
          aria-label="Перетащить"
          tabIndex={-1}
        >
          <GripVertical size={14} />
        </button>
      )}

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
            {String(index + 1).padStart(2, '0')}
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

      <div className="flex items-center gap-0.5 opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100">
        <Button
          variant="ghost"
          size="icon"
          className={'h-7 w-7 ' + (liked ? 'text-[var(--color-accent)]' : '')}
          onClick={(e) => {
            e.stopPropagation();
            if (!isAuthed) return;
            toggle(track);
          }}
          aria-label={liked ? 'Убрать лайк' : 'Лайк'}
        >
          <Heart size={14} fill={liked ? 'currentColor' : 'none'} />
        </Button>
        <div ref={menuRef} className="relative">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen((v) => !v);
            }}
            aria-label="Ещё"
          >
            <MoreHorizontal size={14} />
          </Button>
          <AnimatePresence>
            {menuOpen && (
              <motion.div
                initial={{ opacity: 0, scale: 0.96, y: -4 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96, y: -4, transition: { duration: 0.12 } }}
                transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
                className="absolute right-0 top-9 z-20 min-w-[200px] overflow-hidden rounded-[var(--radius-md)] border border-border bg-card p-1 shadow-[var(--shadow-lg)]"
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  type="button"
                  onClick={handleRemove}
                  disabled={removeMutation.isPending}
                  className="flex w-full items-center gap-2 rounded-[var(--radius-sm)] px-3 py-2 text-left text-sm text-[var(--color-danger)] transition-colors hover:bg-[var(--color-danger-muted)] disabled:opacity-60"
                >
                  <Trash2 size={14} />
                  Удалить из плейлиста
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </>
  );

  if (reorderable) {
    return (
      <Reorder.Item
        value={track}
        dragListener={false}
        dragControls={dragControls}
        onDragEnd={handleDragEnd}
        className={
          'group flex cursor-pointer items-center gap-3 border-b border-border bg-[var(--color-bg)] px-3 py-2 last:border-b-0 transition-colors hover:bg-secondary ' +
          (dragging ? 'z-10 shadow-[var(--shadow-lg)] ring-1 ring-[var(--color-border-strong)]' : '')
        }
        onClick={() => !dragging && onPlay(track)}
      >
        {content}
      </Reorder.Item>
    );
  }

  return (
    <div
      className="group flex cursor-pointer items-center gap-3 border-b border-border px-3 py-2 last:border-b-0 transition-colors hover:bg-secondary"
      onClick={() => onPlay(track)}
    >
      {content}
    </div>
  );
}
