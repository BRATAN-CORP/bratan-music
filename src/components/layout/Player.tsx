import {
  Play, Pause, SkipBack, SkipForward,
  Volume2, VolumeX, Shuffle, Repeat, Repeat1,
} from 'lucide-react';
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

  if (!currentTrack) return null;

  const progressPct = duration > 0 ? (progress / duration) * 100 : 0;

  return (
    <div
      className="fixed bottom-14 left-0 right-0 z-30 flex flex-col border-t border-border bg-[var(--player-bg)] lg:bottom-0 lg:left-60"
      style={{ height: 'var(--player-height)' }}
    >
      <div
        className="h-1 cursor-pointer bg-secondary"
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const pct = (e.clientX - rect.left) / rect.width;
          seek(pct * duration);
        }}
      >
        <div
          className="h-full bg-foreground transition-[width] duration-150"
          style={{ width: `${progressPct}%` }}
        />
      </div>

      <div className="flex items-center gap-4 px-4 flex-1">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          {currentTrack.coverUrl && (
            <img
              src={currentTrack.coverUrl}
              alt={currentTrack.title}
              className="h-11 w-11 rounded-[var(--radius-sm)] object-cover"
            />
          )}
          <div className="min-w-0">
            <p className="text-sm font-medium truncate">{currentTrack.title}</p>
            <p className="truncate text-xs text-muted-foreground">
              {currentTrack.artist}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1">
          <Button onClick={toggleShuffle} variant="ghost" size="icon" className="hidden md:inline-flex" aria-label="Перемешать">
            <Shuffle size={15} className={shuffle ? 'text-foreground' : 'text-muted-foreground'} />
          </Button>
          <Button onClick={previous} variant="ghost" size="icon" aria-label="Предыдущий">
            <SkipBack size={16} />
          </Button>
          <Button onClick={togglePlay} size="icon" className="h-10 w-10" aria-label={isPlaying ? 'Пауза' : 'Пуск'}>
            {isPlaying ? <Pause size={16} /> : <Play size={16} />}
          </Button>
          <Button onClick={next} variant="ghost" size="icon" aria-label="Следующий">
            <SkipForward size={16} />
          </Button>
          <Button onClick={cycleRepeat} variant="ghost" size="icon" className="hidden md:inline-flex" aria-label="Повтор">
            {repeat === 'one' ? (
              <Repeat1 size={15} className="text-foreground" />
            ) : (
              <Repeat size={15} className={repeat === 'all' ? 'text-foreground' : 'text-muted-foreground'} />
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
          />
        </div>
      </div>
    </div>
  );
}
