import { useState } from 'react';
import { Reorder, useDragControls } from 'motion/react';
import { Ban, GripVertical, ListOrdered, Pause, Play, Trash2, X } from 'lucide-react';
import { usePlayerStore } from '@/store/player';
import type { Track } from '@/types';
import { ArtistLinks } from '@/components/features/ArtistLinks';
import { Modal } from '@/components/ui/Modal';
import { useIsTrackBanned } from '@/hooks/useDislikedTrack';
import { useOfflineCoverUrl } from '@/hooks/useOfflineCoverUrl';
import { useT } from '@/i18n';

interface QueueDialogProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Queue editor. Centred dialog at every breakpoint — the user explicitly
 * asked for the modal to land in the middle of the screen on mobile too,
 * because the previous bottom-sheet positioning visibly drifted off the
 * vertical centre line of the fullscreen player and read as off-axis.
 * The shared `Modal` primitive owns the scrim + dismiss; we just pin the
 * panel size and let `align="center"` vertically centre it inside the
 * viewport. The mobile dock at z-40 sits behind the modal scrim (z-60),
 * so the dock is blurred-out by the scrim while the panel is visible.
 *
 * Drag-to-reorder is split by pointer type (the original bug: a finger
 * swipe over a row was committing to a `Reorder.Item` drag instead of
 * scrolling the list, because motion's default `dragListener` claims
 * vertical pointer-down anywhere on the item). Mouse keeps the original
 * "drag from anywhere on the row" behaviour because there's no
 * scroll-vs-drag gesture conflict on a desktop pointer (wheel scrolls
 * the list, pointer-down drags rows). Touch is restricted to the
 * `GripVertical` handle on the left so a finger anywhere ELSE on the
 * row falls through to the parent's native vertical pan, which scrolls
 * the queue.
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
    <Modal
      open={open}
      onClose={onClose}
      align="center"
      ariaLabel={t('queue.title')}
      // The panel max-height leaves enough vertical room above and
      // below for the centred layout to clear (a) the persistent
      // mobile bottom dock that sits at `bottom-4` + ~5rem of stacked
      // mini-player + nav, and (b) the iOS PWA safe-bottom inset.
      // 9rem of total reduction → ~4.5rem of margin on each side
      // when the queue fills the full panel height; on shorter
      // queues the panel collapses to its content and the centre
      // alignment puts it visually mid-screen.
      panelClassName="flex w-[min(520px,calc(100vw-24px))] flex-col max-h-[calc(100dvh-9rem-var(--pwa-safe-bottom))]"
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
    </Modal>
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
 *
 * Drag is started manually via `useDragControls` so we can split touch
 * vs mouse: mouse path drags from anywhere on the row, touch path is
 * restricted to the `GripVertical` handle. See `QueueDialog` doc-comment
 * for the rationale.
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
  const dragControls = useDragControls();

  // Mouse-only drag start on the row body. We early-return for any
  // non-mouse pointer so touch falls through to the parent
  // `overflow-y-auto` container and the user can scroll the queue with
  // their finger. Motion's tap-vs-drag heuristic fires the inner
  // button's `onClick` if the pointer never moves past the drag
  // threshold, so a plain mouse click on the row still toggles play.
  const handleRowPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType !== 'mouse') return;
    dragControls.start(e);
  };
  // Grip-handle drag start is unconditional (touch + mouse). We
  // `preventDefault` so the desktop browser doesn't start a native
  // text-selection drag from the icon, and `stopPropagation` so the
  // row's own pointer-down listener doesn't double-start the drag for
  // a mouse press on the handle.
  const handleHandlePointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragControls.start(e);
  };

  return (
    <Reorder.Item
      value={track}
      dragListener={false}
      dragControls={dragControls}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onPointerDown={handleRowPointerDown}
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
        // `touch-none` opts the handle out of the parent's native
        // vertical pan so a finger press-and-drag on the icon goes
        // straight into motion's drag pipeline (the rest of the row
        // keeps `pan-y` so a finger anywhere else scrolls the queue).
        className="flex h-7 w-5 shrink-0 cursor-grab touch-none items-center justify-center text-muted-foreground/70 active:cursor-grabbing"
        onPointerDown={handleHandlePointerDown}
        aria-label={t('queue.dragHandle')}
        role="button"
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
