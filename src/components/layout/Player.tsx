import {
  Play, Pause, SkipBack, SkipForward,
  Volume2, VolumeX, Shuffle, Repeat, Repeat1,
} from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { usePlayerStore } from '@/store/player';
import { useAudioPlayer } from '@/hooks/useAudioPlayer';
import { Button } from '@/components/ui/Button';

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
    duration,
  } = usePlayerStore();

  const { progress, seek } = useAudioPlayer();
  const reduce = useReducedMotion();

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
      <div
        className="group/progress relative h-1 cursor-pointer bg-[var(--color-bg-muted)]"
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const pct = (e.clientX - rect.left) / rect.width;
          seek(pct * duration);
        }}
      >
        <div
          className="h-full bg-foreground transition-[width] duration-100"
          style={{ width: `${progressPct}%` }}
        />
        <div
          className="absolute top-1/2 h-3 w-3 -translate-y-1/2 -translate-x-1/2 rounded-full bg-foreground opacity-0 transition-opacity group-hover/progress:opacity-100"
          style={{ left: `${progressPct}%` }}
        />
      </div>

      <div className="flex items-center gap-4 px-4 flex-1">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          {currentTrack.coverUrl && (
            <motion.img
              src={currentTrack.coverUrl}
              alt={currentTrack.title}
              className="h-11 w-11 rounded-[var(--radius-sm)] border border-border object-cover"
              initial={reduce ? false : { scale: 0.8, opacity: 0 }}
              animate={reduce ? undefined : { scale: 1, opacity: 1 }}
              key={currentTrack.id}
            />
          )}
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{currentTrack.title}</p>
            <p className="truncate text-xs text-muted-foreground">{currentTrack.artist}</p>
          </div>
        </div>

        <div className="flex items-center gap-1">
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

        <div className="hidden md:flex items-center gap-2 flex-1 justify-end">
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
            className="w-20 accent-[var(--color-accent)]"
            aria-label="Громкость"
          />
        </div>
      </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
