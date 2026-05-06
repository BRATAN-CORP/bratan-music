import { useState } from 'react';
import { Pause, Play, GripVertical, Ban } from 'lucide-react';
import { Reorder, useDragControls, type PanInfo } from 'motion/react';
import type { Track } from '@/types';
import { useTrackPlayback } from '@/hooks/usePlaybackSync';
import { useIsTrackBanned } from '@/hooks/useDislikedTrack';
import { useOfflineCoverUrl } from '@/hooks/useOfflineCoverUrl';
import { ArtistLinks } from '@/components/features/ArtistLinks';
import { TrackInlineActions } from '@/components/features/TrackInlineActions';
import { useT } from '@/i18n';

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
  const t = useT();
  const { isActive, isActivePlaying, playOrToggle } = useTrackPlayback(track.id);
  const banned = useIsTrackBanned(track);
  const dragControls = useDragControls();
  const [dragging, setDragging] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  // Prefer the locally-stored cover blob when the track is saved
  // offline so the row keeps painting real artwork even when the
  // device is offline (otherwise the network URL fails and the
  // browser falls back to its broken-image glyph).
  const coverUrl = useOfflineCoverUrl('track', track.id, track.coverUrl);

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
          aria-label={t('playlistTrackItem.drag')}
          tabIndex={-1}
        >
          <GripVertical size={14} />
        </button>
      )}

      <div className="flex h-10 w-10 shrink-0 items-center justify-center">
        {coverUrl ? (
          <div className="relative h-10 w-10 overflow-hidden rounded-[var(--radius-sm)]">
            <img src={coverUrl} alt="" className="h-full w-full object-cover" />
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
        <p className={'flex items-center gap-1.5 truncate text-sm font-medium ' + (isActive ? 'text-[var(--color-accent)]' : '')}>
          {banned && (
            <span
              className="inline-flex h-4 w-4 shrink-0 items-center justify-center text-muted-foreground/70"
              title={t('track.bannedHint')}
              aria-label={t('track.bannedHint')}
            >
              <Ban size={12} />
            </span>
          )}
          <span className="truncate">{track.title}</span>
        </p>
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

      <TrackInlineActions
        track={track}
        hovered={hovered}
        menuOpen={menuOpen}
        onMenuOpenChange={setMenuOpen}
        playlistId={playlistId}
        hideRemoveFromPlaylistMenu={hideRemoveMenu}
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
        animate={{ opacity: banned && !isActive ? 0.45 : 1 }}
        whileDrag={{
          scale: 1.02,
          boxShadow: '0 18px 36px -12px rgba(0,0,0,0.45)',
          cursor: 'grabbing',
          zIndex: 5,
        }}
        whileHover={banned && !isActive ? { opacity: 1 } : undefined}
        style={{ position: 'relative' }}
        className={
          'group flex cursor-pointer items-center gap-3 border-b border-border bg-[var(--color-bg)] px-3 py-2 last:border-b-0 transition-colors hover:bg-secondary ' +
          (banned && !isActive ? 'saturate-50' : '')
        }
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => setHovered(false)}
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
      className={
        'group flex cursor-pointer items-center gap-3 border-b border-border px-3 py-2 last:border-b-0 transition-[colors,opacity] hover:bg-secondary hover:opacity-100 ' +
        (banned && !isActive ? 'opacity-50 saturate-50' : '')
      }
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
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
