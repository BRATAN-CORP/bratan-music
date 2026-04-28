import { useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { GripVertical, ListOrdered, Play, Trash2, X } from 'lucide-react';
import { usePlayerStore } from '@/store/player';

interface QueueDialogProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Queue editor in the same glass-card vocabulary as AddToPlaylistDialog —
 * bottom-sheet on mobile, centered modal on md+. Lets the user reorder via
 * native HTML5 drag-and-drop, drop a track onto the trash zone or remove it
 * inline, and jump to any track by clicking it.
 */
export function QueueDialog({ open, onClose }: QueueDialogProps) {
  const reduce = useReducedMotion();
  const queue = usePlayerStore((s) => s.queue);
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const removeFromQueue = usePlayerStore((s) => s.removeFromQueue);
  const reorderQueue = usePlayerStore((s) => s.reorderQueue);
  const jumpToQueue = usePlayerStore((s) => s.jumpToQueue);

  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  const handleDragStart = (index: number) => (e: React.DragEvent) => {
    setDragIndex(index);
    e.dataTransfer.effectAllowed = 'move';
    // Some browsers refuse to start the drag without payload.
    try { e.dataTransfer.setData('text/plain', String(index)); } catch { /* noop */ }
  };
  const handleDragOver = (index: number) => (e: React.DragEvent) => {
    e.preventDefault();
    setOverIndex(index);
  };
  const handleDrop = (index: number) => (e: React.DragEvent) => {
    e.preventDefault();
    if (dragIndex == null) return;
    if (dragIndex !== index) reorderQueue(dragIndex, index);
    setDragIndex(null);
    setOverIndex(null);
  };
  const handleDragEnd = () => {
    setDragIndex(null);
    setOverIndex(null);
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
                  <ul className="flex flex-col">
                    {queue.map((t, i) => {
                      const isActive = currentTrack?.id === t.id;
                      const isDragOver = overIndex === i && dragIndex !== i;
                      return (
                        <li
                          key={`${t.id}-${i}`}
                          draggable
                          onDragStart={handleDragStart(i)}
                          onDragOver={handleDragOver(i)}
                          onDrop={handleDrop(i)}
                          onDragEnd={handleDragEnd}
                          className={[
                            'group relative flex items-center gap-2 rounded-[var(--radius-md)] px-2 py-2 transition-colors',
                            isActive
                              ? 'bg-[var(--color-hover-overlay-strong)]'
                              : 'hover:bg-[var(--color-hover-overlay-strong)] focus-within:bg-[var(--color-hover-overlay-strong)]',
                            isDragOver ? 'ring-1 ring-[var(--color-accent)]' : '',
                            dragIndex === i ? 'opacity-60' : '',
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
                            onClick={() => jumpToQueue(i)}
                            className="flex min-w-0 flex-1 items-center gap-3 text-left"
                            aria-label={`Воспроизвести ${t.title}`}
                          >
                            {t.coverUrl ? (
                              <img
                                src={t.coverUrl}
                                alt=""
                                className="h-9 w-9 shrink-0 rounded-[var(--radius-sm)] object-cover"
                              />
                            ) : (
                              <div className="h-9 w-9 shrink-0 rounded-[var(--radius-sm)] bg-secondary" />
                            )}
                            <div className="min-w-0">
                              <p
                                className={`truncate text-sm ${isActive ? 'font-semibold text-[var(--color-accent)]' : 'font-medium'}`}
                              >
                                {t.title}
                              </p>
                              <p className="truncate text-xs text-muted-foreground">{t.artist}</p>
                            </div>
                            {isActive && (
                              <span className="ml-auto inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--color-accent)]/15 text-[var(--color-accent)]">
                                <Play size={12} fill="currentColor" />
                              </span>
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={() => removeFromQueue(t.id)}
                            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted-foreground/70 transition-colors hover:bg-[var(--color-danger-muted)] hover:text-[var(--color-danger)]"
                            aria-label={`Убрать ${t.title} из очереди`}
                            disabled={isActive}
                            title={isActive ? 'Сейчас играет' : 'Убрать из очереди'}
                          >
                            <Trash2 size={13} />
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );
}
