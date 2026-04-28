import { useState } from 'react';
import { motion, AnimatePresence, Reorder, useReducedMotion } from 'motion/react';
import { GripVertical, ListOrdered, Pause, Play, Trash2, X } from 'lucide-react';
import { usePlayerStore } from '@/store/player';
import type { Track } from '@/types';

interface QueueDialogProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Queue editor in the same glass-card vocabulary as AddToPlaylistDialog —
 * bottom-sheet on mobile, centered modal on md+. Uses motion's
 * `Reorder.Group` so the surrounding tracks visibly flow around the
 * dragged item (П5) instead of just being marked with a ring.
 */
export function QueueDialog({ open, onClose }: QueueDialogProps) {
  const reduce = useReducedMotion();
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
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="queue-backdrop"
            initial={reduce ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="liquid-glass-scrim fixed inset-0 z-[60]"
            onClick={onClose}
            aria-hidden
          />

          <div className="fixed inset-0 z-[60] flex flex-col items-center justify-end md:justify-center pointer-events-none">
            <motion.div
              key="queue-panel"
              role="dialog"
              aria-modal="true"
              aria-label="Очередь"
              initial={{ opacity: 0, y: 32, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 32, scale: 0.97, transition: { duration: 0.18 } }}
              transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
              style={{ maxHeight: 'calc(100dvh - 7rem - env(safe-area-inset-bottom, 0px))' }}
              className="liquid-glass pointer-events-auto mx-3 mb-[calc(env(safe-area-inset-bottom,0px)+5rem)] flex w-[min(520px,calc(100vw-24px))] flex-col overflow-hidden rounded-[var(--radius-xl)] md:mb-0 md:rounded-[var(--radius-lg)]"
            >
              <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
                <div className="flex min-w-0 items-center gap-2">
                  <ListOrdered size={15} className="text-muted-foreground" />
                  <span className="truncate text-sm font-medium">Очередь</span>
                  <span className="text-xs text-muted-foreground">· {queue.length}</span>
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                  aria-label="Закрыть"
                >
                  <X size={14} />
                </button>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
                {queue.length === 0 ? (
                  <p className="px-3 py-10 text-center text-xs text-muted-foreground">
                    Очередь пуста
                  </p>
                ) : (
                  <Reorder.Group
                    axis="y"
                    values={queue}
                    onReorder={handleReorder}
                    className="flex flex-col"
                    layoutScroll
                  >
                    {queue.map((t, i) => {
                      const active = currentTrack?.id === t.id;
                      return (
                        <QueueRow
                          key={t.id}
                          track={t}
                          index={i}
                          active={active}
                          isPlaying={active && isPlaying}
                          dragging={draggingId === t.id}
                          onDragStart={() => setDraggingId(t.id)}
                          onDragEnd={() => setDraggingId(null)}
                          // Active row toggles play/pause; inactive
                          // rows jump-and-play. Single click = single
                          // intent, mirrors how TrackItem behaves.
                          onJump={() => (active ? togglePlay() : jumpToQueue(i))}
                          onRemove={() => removeFromQueue(t.id)}
                        />
                      );
                    })}
                  </Reorder.Group>
                )}
              </div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
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
  return (
    <Reorder.Item
      value={track}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      // Spring tuned to feel "liquid" — neighbours reflow with a soft
      // bounce-free curve, but the dragged item snaps tightly to the
      // pointer so it doesn't feel rubbery.
      transition={{ type: 'spring', stiffness: 600, damping: 50, mass: 1 }}
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
        aria-label={`Воспроизвести ${track.title}`}
      >
        {track.coverUrl ? (
          <img
            src={track.coverUrl}
            alt=""
            className="h-9 w-9 shrink-0 rounded-[var(--radius-sm)] object-cover"
          />
        ) : (
          <div className="h-9 w-9 shrink-0 rounded-[var(--radius-sm)] bg-secondary" />
        )}
        <div className="min-w-0">
          <p
            className={`truncate text-sm ${active ? 'font-semibold text-[var(--color-accent)]' : 'font-medium'}`}
          >
            {track.title}
          </p>
          <p className="truncate text-xs text-muted-foreground">{track.artist}</p>
        </div>
        {active && (
          <span
            aria-label={isPlaying ? 'Сейчас играет' : 'На паузе'}
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
        aria-label={`Убрать ${track.title} из очереди`}
        disabled={active}
        title={active ? 'Сейчас играет' : 'Убрать из очереди'}
      >
        <Trash2 size={13} />
      </button>
    </Reorder.Item>
  );
}
