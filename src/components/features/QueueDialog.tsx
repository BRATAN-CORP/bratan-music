import { useState } from 'react';
import { Reorder } from 'motion/react';
import { Ban, GripVertical, ListOrdered, Pause, Play, Trash2, X } from 'lucide-react';
import { usePlayerStore } from '@/store/player';
import type { Track } from '@/types';
import { ArtistLinks } from '@/components/features/ArtistLinks';
import { Sheet } from '@/components/ui/Sheet';
import { useIsTrackBanned } from '@/hooks/useDislikedTrack';
import { useOfflineCoverUrl } from '@/hooks/useOfflineCoverUrl';
import { useT } from '@/i18n';

interface QueueDialogProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Queue editor. Bottom-sheet on mobile, centered modal on md+ via the
 * shared `Sheet` primitive. Uses motion's `Reorder.Group` so surrounding
 * tracks visibly flow around the dragged item.
 */
export function QueueDialog({ open, onClose }: QueueDialogProps) {
  const t = useT();
  const queue = usePlayerStore((s) => s.queue);
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const togglePlay = usePlayerStore((s) => s.togglePlay);
  const removeFromQueue = usePlayerStore((s) => s.removeFromQueue);
  const setQueue = usePlayerStore((s) => s.setQueue);
  const jumpToQueue = usePlayerStore((s) => s.jumpToQueue);

  const [draggingId, setDraggingId] = useState<string | null>(null);

  const handleReorder = (next: Track[]) => {
    setQueue(next);
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      ariaLabel={t('queue.title')}
      panelClassName="flex w-[min(520px,calc(100vw-24px))] flex-col max-h-[calc(100dvh-7rem-var(--pwa-safe-bottom))]"
    >
      <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <ListOrdered size={15} className="text-muted-foreground" />
          <span className="truncate text-sm font-medium">{t('queue.title')}</span>
          <span className="text-xs text-muted-foreground">· {queue.length}</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          aria-label={t('common.close')}
        >
          <X size={14} />
        </button>
      </div>

      <div data-allow-pan-y className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {queue.length === 0 ? (
          <p className="px-3 py-10 text-center text-xs text-muted-foreground">
            {t('queue.empty')}
          </p>
        ) : (
          <Reorder.Group
            axis="y"
            values={queue}
            onReorder={handleReorder}
            className="flex flex-col"
            layoutScroll
          >
            {queue.map((track, i) => {
              const active = currentTrack?.id === track.id;
              return (
                <QueueRow
                  key={track.id}
                  track={track}
                  index={i}
                  active={active}
                  isPlaying={active && isPlaying}
                  dragging={draggingId === track.id}
                  onDragStart={() => setDraggingId(track.id)}
                  onDragEnd={() => setDraggingId(null)}
                  // Active row toggles play/pause; inactive rows
                  // jump-and-play. Single click = single intent.
                  onJump={() => (active ? togglePlay() : jumpToQueue(i))}
                  onRemove={() => removeFromQueue(track.id)}
                />
              );
            })}
          </Reorder.Group>
        )}
      </div>
    </Sheet>
  );
}

interface RowProps {
  track: Track;
  index: number;
  active: boolean;
  isPlaying: boolean;
  dragging: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onJump: () => void;
  onRemove: () => void;
}

/**
 * Single queue row. The whole row is a `Reorder.Item` keyed by track —
 * surrounding rows automatically reflow around it via motion's layout
 * animation while the user drags. We bump the dragged row's z-index and
 * scale slightly so it visually lifts above its neighbours.
 */
function QueueRow({
  track,
  active,
  isPlaying,
  dragging,
  onDragStart,
  onDragEnd,
  onJump,
  onRemove,
}: RowProps) {
  const t = useT();
  const banned = useIsTrackBanned(track);
  // Prefer the locally-stored cover blob when the track is saved
  // offline so the queue keeps painting real artwork even when the
  // device is offline (otherwise the network URL fails and the
  // browser falls back to its broken-image glyph).
  const coverUrl = useOfflineCoverUrl('track', track.id, track.coverUrl);
  return (
    <Reorder.Item
      value={track}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      // Spring tuned to feel "liquid" — neighbours reflow with a soft
      // bounce-free curve, but the dragged item snaps tightly to the
      // pointer so it doesn't feel rubbery.
      transition={{ type: 'spring', stiffness: 600, damping: 50, mass: 1 }}
      animate={{ opacity: banned && !active ? 0.45 : 1 }}
      whileHover={banned && !active ? { opacity: 1 } : undefined}
      whileDrag={{
        scale: 1.03,
        boxShadow: '0 18px 36px -12px rgba(0,0,0,0.45)',
        cursor: 'grabbing',
        zIndex: 5,
      }}
      style={{ position: 'relative' }}
      className={[
        'group relative flex items-center gap-2 rounded-[var(--radius-md)] px-2 py-2 transition-colors',
        active
          ? 'bg-[var(--color-hover-overlay-strong)]'
          : 'hover:bg-[var(--color-hover-overlay-strong)] focus-within:bg-[var(--color-hover-overlay-strong)]',
        dragging ? 'shadow-lg' : '',
        banned && !active ? 'saturate-50' : '',
      ].join(' ')}
    >
      <span
        className="flex h-7 w-5 shrink-0 cursor-grab items-center justify-center text-muted-foreground/70 active:cursor-grabbing"
        aria-hidden
      >
        <GripVertical size={14} />
      </span>
      <button
        type="button"
        onClick={onJump}
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
        aria-label={t('queue.playTrack', { title: track.title })}
      >
        {coverUrl ? (
          <img
            src={coverUrl}
            alt=""
            className="h-9 w-9 shrink-0 rounded-[var(--radius-sm)] object-cover"
          />
        ) : (
          <div className="h-9 w-9 shrink-0 rounded-[var(--radius-sm)] bg-secondary" />
        )}
        <div className="min-w-0">
          <p
            className={`flex items-center gap-1.5 truncate text-sm ${active ? 'font-semibold text-[var(--color-accent)]' : 'font-medium'}`}
          >
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
        {active && (
          <span
            aria-label={isPlaying ? t('queue.playing') : t('queue.paused')}
            className="ml-auto inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--color-accent)]/15 text-[var(--color-accent)]"
          >
            {isPlaying
              ? <Pause size={12} fill="currentColor" strokeWidth={0} />
              : <Play size={12} fill="currentColor" />}
          </span>
        )}
      </button>
      <button
        type="button"
        onClick={onRemove}
        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted-foreground/70 transition-colors hover:bg-[var(--color-danger-muted)] hover:text-[var(--color-danger)]"
        aria-label={t('queue.removeTrack', { title: track.title })}
        disabled={active}
        title={active ? t('queue.playing') : t('queue.removeTooltip')}
      >
        <Trash2 size={13} />
      </button>
    </Reorder.Item>
  );
}
