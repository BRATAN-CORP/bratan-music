import { useRef, useState } from 'react';
import { Download, Heart, MoreHorizontal, Pause, Play, Trash2, GripVertical, Upload } from 'lucide-react';
import { Reorder, useDragControls, type PanInfo } from 'motion/react';
import type { Track } from '@/types';
import { Button } from '@/components/ui/Button';
import { PopoverMenu } from '@/components/ui/PopoverMenu';
import { useToggleLike, useRemoveTrackFromPlaylist } from '@/hooks/useLibrary';
import { useAuthStore } from '@/store/auth';
import { useTrackPlayback } from '@/hooks/usePlaybackSync';
import { useCoarsePointer } from '@/hooks/useCoarsePointer';
import { downloadTrack } from '@/lib/trackActions';
import { TrackOverrideModal } from '@/components/features/TrackOverrideModal';
import { ArtistLinks } from '@/components/features/ArtistLinks';

interface PlaylistTrackItemProps {
  track: Track;
  index: number;
  playlistId: string;
  reorderable: boolean;
  onPlay: (track: Track) => void;
  onReorderEnd?: () => void;
  /**
   * Hide the kebab menu (the only action of which is "remove from playlist").
   * Used for the system "Liked" playlist where unliking already removes the
   * track, so there is no separate delete affordance.
   */
  hideRemoveMenu?: boolean;
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
  hideRemoveMenu,
}: PlaylistTrackItemProps) {
  const isAuthed = useAuthStore((s) => Boolean(s.user));
  const { isLiked, toggle } = useToggleLike();
  const liked = isAuthed && isLiked(track.id);
  const { isActive, isActivePlaying, playOrToggle } = useTrackPlayback(track.id);
  const removeMutation = useRemoveTrackFromPlaylist();
  const coarse = useCoarsePointer();
  const dragControls = useDragControls();
  const [dragging, setDragging] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [overrideOpen, setOverrideOpen] = useState(false);
  const menuTriggerRef = useRef<HTMLButtonElement | null>(null);

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
            {/* Match TrackItem's overlay logic: when this row is the
                currently-loaded track we always show the overlay
                (Pause if audio is advancing, Play if it's paused);
                otherwise the overlay only appears on hover. */}
            <div
              className={
                'absolute inset-0 items-center justify-center bg-[var(--color-media-overlay)] ' +
                (isActive ? 'flex opacity-100' : 'hidden group-hover:flex')
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
            {String(index + 1).padStart(2, '0')}
          </span>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <p className={'truncate text-sm font-medium ' + (isActive ? 'text-[var(--color-accent)]' : '')}>{track.title}</p>
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
              onClick={(e) => { e.stopPropagation(); setOverrideOpen(true); }}
              aria-label="Загрузить свою версию"
              title="Загрузить свою версию"
            >
              <Upload size={14} />
            </Button>
          </>
        )}
        {!hideRemoveMenu && (
          <>
            <Button
              ref={menuTriggerRef}
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
            <PopoverMenu
              open={menuOpen}
              onClose={() => setMenuOpen(false)}
              triggerRef={menuTriggerRef}
              anchor="bottom"
              align="end"
              width={200}
              className="p-1"
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
            </PopoverMenu>
          </>
        )}
      </div>

      <TrackOverrideModal
        open={overrideOpen}
        onClose={() => setOverrideOpen(false)}
        trackId={track.id}
        trackTitle={`${track.artist} — ${track.title}`}
      />
    </>
  );

  if (reorderable) {
    return (
      <Reorder.Item
        value={track}
        dragListener={false}
        dragControls={dragControls}
        onDragEnd={handleDragEnd}
        // Spring tuned to feel "liquid" — neighbours reflow with a soft
        // bounce-free curve, but the dragged item snaps tightly to the
        // pointer so it doesn't feel rubbery (П5).
        transition={{ type: 'spring', stiffness: 600, damping: 50, mass: 1 }}
        whileDrag={{
          scale: 1.02,
          boxShadow: '0 18px 36px -12px rgba(0,0,0,0.45)',
          cursor: 'grabbing',
          zIndex: 5,
        }}
        style={{ position: 'relative' }}
        className={
          'group flex cursor-pointer items-center gap-3 border-b border-border bg-[var(--color-bg)] px-3 py-2 last:border-b-0 transition-colors hover:bg-secondary'
        }
        onClick={() => {
          if (dragging) return;
          if (isActive) {
            playOrToggle(track);
            return;
          }
          onPlay(track);
        }}
      >
        {content}
      </Reorder.Item>
    );
  }

  return (
    <div
      className="group flex cursor-pointer items-center gap-3 border-b border-border px-3 py-2 last:border-b-0 transition-colors hover:bg-secondary"
      onClick={() => {
        if (isActive) {
          playOrToggle(track);
          return;
        }
        onPlay(track);
      }}
    >
      {content}
    </div>
  );
}
