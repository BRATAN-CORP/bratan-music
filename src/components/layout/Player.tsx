import {
  Play, Pause, SkipBack, SkipForward,
  Volume2, VolumeX, Shuffle, Repeat, Repeat1, Maximize2, AlertTriangle, Heart,
} from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { usePlayerStore } from '@/store/player';
import { useAudioPlayer } from '@/hooks/useAudioPlayer';
import { Button } from '@/components/ui/Button';
import { useToggleLike } from '@/hooks/useLibrary';
import { triggerLikeBurst } from '@/lib/likeFeedback';

function formatTime(seconds: number): string {
  if (!seconds || !isFinite(seconds)) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function Player() {
  const {
    currentTrack, isPlaying, togglePlay, next, previous,
    muted, toggleMute, volume, setVolume,
    shuffle, toggleShuffle, repeat, cycleRepeat,
    duration, error, openFullscreen,
  } = usePlayerStore();

  const { progress, seek } = useAudioPlayer();
  const reduce = useReducedMotion();
  const { isLiked, toggle } = useToggleLike();
  const liked = currentTrack ? isLiked(currentTrack.id) : false;

  const progressPct = duration > 0 ? (progress / duration) * 100 : 0;

  return (
    <AnimatePresence>
      {currentTrack && (
        <motion.div
          key="player"
          initial={reduce ? false : { y: 80, opacity: 0 }}
          animate={reduce ? undefined : { y: 0, opacity: 1 }}
          exit={reduce ? undefined : { y: 80, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 280, damping: 30 }}
          className="fixed bottom-14 left-0 right-0 z-30 flex flex-col border-t border-border glass lg:bottom-0 lg:left-60"
          style={{ height: 'var(--player-height)' }}
        >
          {error && (
            <div className="flex items-center gap-2 bg-[var(--color-danger-muted)] px-4 py-1.5 text-xs text-[var(--color-danger)]">
              <AlertTriangle size={12} className="shrink-0" />
              <span className="truncate">{error}</span>
            </div>
          )}

          <div
            className="group/progress relative h-2 cursor-pointer touch-none bg-[var(--color-bg-muted)] sm:h-1"
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              const rect = e.currentTarget.getBoundingClientRect();
              const seekFromX = (clientX: number) => {
                const pct = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
                seek(pct * duration);
              };
              seekFromX(e.clientX);
              const target = e.currentTarget;
              const onMove = (ev: PointerEvent) => seekFromX(ev.clientX);
              const onUp = (ev: PointerEvent) => {
                seekFromX(ev.clientX);
                target.removeEventListener('pointermove', onMove);
                target.removeEventListener('pointerup', onUp);
                target.removeEventListener('pointercancel', onUp);
                try { target.releasePointerCapture(ev.pointerId); } catch { /* ignore */ }
              };
              target.addEventListener('pointermove', onMove);
              target.addEventListener('pointerup', onUp);
              target.addEventListener('pointercancel', onUp);
            }}
          >
            <div
              className="h-full bg-gradient-to-r from-[var(--color-accent)] via-[var(--color-sub-accent)] to-[var(--color-accent)] transition-[width] duration-100"
              style={{ width: `${progressPct}%` }}
            />
            <div
              className="absolute top-1/2 h-4 w-4 -translate-y-1/2 -translate-x-1/2 rounded-full bg-[var(--color-accent)] shadow-[0_0_0_2px_var(--color-bg)] opacity-0 transition-opacity group-hover/progress:opacity-100"
              style={{ left: `${progressPct}%` }}
            />
          </div>

          <div className="flex flex-1 items-center gap-4 px-4">
            <button
              onClick={openFullscreen}
              className="group flex min-w-0 flex-1 items-center gap-3 text-left transition-opacity hover:opacity-90"
              aria-label="Открыть плеер"
            >
              {currentTrack.coverUrl && (
                <motion.div
                  className="relative h-11 w-11 shrink-0 overflow-hidden rounded-[var(--radius-sm)] border border-border"
                  initial={reduce ? false : { scale: 0.8, opacity: 0 }}
                  animate={reduce ? undefined : { scale: 1, opacity: 1 }}
                  key={currentTrack.id}
                >
                  <img src={currentTrack.coverUrl} alt={currentTrack.title} className="h-full w-full object-cover" />
                  <div className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 transition-opacity group-hover:opacity-100">
                    <Maximize2 size={14} className="text-white" />
                  </div>
                </motion.div>
              )}
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{currentTrack.title}</p>
                <p className="truncate text-xs text-muted-foreground">{currentTrack.artist}</p>
              </div>
            </button>

            <div className="flex items-center gap-1">
              <motion.div whileTap={reduce ? undefined : { scale: 0.85 }}>
                <Button
                  onClick={(e) => {
                    if (!currentTrack) return;
                    triggerLikeBurst(e, liked ? 'unliked' : 'liked');
                    toggle(currentTrack);
                  }}
                  variant="ghost"
                  size="icon"
                  aria-label={liked ? 'Убрать лайк' : 'Лайк'}
                  className={liked ? 'text-[var(--color-accent)]' : ''}
                >
                  <Heart size={15} fill={liked ? 'currentColor' : 'none'} />
                </Button>
              </motion.div>
              <Button onClick={toggleShuffle} variant="ghost" size="icon" className="hidden md:inline-flex" aria-label="Перемешать">
                <Shuffle size={15} className={shuffle ? 'text-[var(--color-accent)]' : 'text-muted-foreground'} />
              </Button>
              <Button onClick={previous} variant="ghost" size="icon" aria-label="Предыдущий">
                <SkipBack size={16} />
              </Button>
              <motion.div whileTap={reduce ? undefined : { scale: 0.92 }}>
                <Button onClick={togglePlay} size="icon" className="h-10 w-10" aria-label={isPlaying ? 'Пауза' : 'Пуск'}>
                  {isPlaying ? <Pause size={16} /> : <Play size={16} fill="currentColor" />}
                </Button>
              </motion.div>
              <Button onClick={next} variant="ghost" size="icon" aria-label="Следующий">
                <SkipForward size={16} />
              </Button>
              <Button onClick={cycleRepeat} variant="ghost" size="icon" className="hidden md:inline-flex" aria-label="Повтор">
                {repeat === 'one' ? (
                  <Repeat1 size={15} className="text-[var(--color-accent)]" />
                ) : (
                  <Repeat size={15} className={repeat === 'all' ? 'text-[var(--color-accent)]' : 'text-muted-foreground'} />
                )}
              </Button>
            </div>

            <div className="hidden flex-1 items-center justify-end gap-2 md:flex">
              <span className="text-xs text-muted-foreground">
                {formatTime(progress)} / {formatTime(duration)}
              </span>
              <Button onClick={toggleMute} variant="ghost" size="icon" className="h-9 w-9" aria-label="Звук">
                {muted ? <VolumeX size={15} /> : <Volume2 size={15} />}
              </Button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={muted ? 0 : volume}
                onChange={(e) => setVolume(Number(e.target.value))}
                className="w-24 accent-[var(--color-accent)]"
                aria-label="Громкость"
              />
              <Button onClick={openFullscreen} variant="ghost" size="icon" aria-label="Развернуть">
                <Maximize2 size={15} />
              </Button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
