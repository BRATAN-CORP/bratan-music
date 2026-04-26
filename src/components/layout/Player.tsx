import {
  Play, Pause, SkipBack, SkipForward,
  Volume2, VolumeX, Shuffle, Repeat, Repeat1,
} from 'lucide-react';
import { usePlayerStore } from '@/store/player';
import { useAudioPlayer } from '@/hooks/useAudioPlayer';

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
      className="fixed bottom-14 lg:bottom-0 left-0 right-0 z-30 border-t flex flex-col"
      style={{
        height: 'var(--player-height)',
        backgroundColor: 'var(--player-bg)',
        borderColor: 'var(--player-border)',
      }}
    >
      <div
        className="h-1 cursor-pointer"
        style={{ backgroundColor: 'var(--color-bg-muted)' }}
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const pct = (e.clientX - rect.left) / rect.width;
          seek(pct * duration);
        }}
      >
        <div
          className="h-full transition-[width] duration-150"
          style={{ width: `${progressPct}%`, backgroundColor: 'var(--color-accent)' }}
        />
      </div>

      <div className="flex items-center gap-4 px-4 flex-1">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          {currentTrack.coverUrl && (
            <img
              src={currentTrack.coverUrl}
              alt={currentTrack.title}
              className="w-12 h-12 rounded-lg object-cover"
            />
          )}
          <div className="min-w-0">
            <p className="text-sm font-medium truncate">{currentTrack.title}</p>
            <p className="text-xs truncate" style={{ color: 'var(--color-text-muted)' }}>
              {currentTrack.artist}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1">
          <button onClick={toggleShuffle} className="hidden md:block p-2 hover:opacity-80">
            <Shuffle size={16} style={{ color: shuffle ? 'var(--color-accent)' : 'var(--color-text-subtle)' }} />
          </button>
          <button onClick={previous} className="p-2 hover:opacity-80">
            <SkipBack size={18} />
          </button>
          <button
            onClick={togglePlay}
            className="p-2 rounded-full"
            style={{ backgroundColor: 'var(--color-accent)', color: 'var(--color-text-on-accent)' }}
          >
            {isPlaying ? <Pause size={20} /> : <Play size={20} />}
          </button>
          <button onClick={next} className="p-2 hover:opacity-80">
            <SkipForward size={18} />
          </button>
          <button onClick={cycleRepeat} className="hidden md:block p-2 hover:opacity-80">
            {repeat === 'one' ? (
              <Repeat1 size={16} style={{ color: 'var(--color-accent)' }} />
            ) : (
              <Repeat size={16} style={{ color: repeat === 'all' ? 'var(--color-accent)' : 'var(--color-text-subtle)' }} />
            )}
          </button>
        </div>

        <div className="hidden md:flex items-center gap-2 flex-1 justify-end">
          <span className="text-xs" style={{ color: 'var(--color-text-subtle)' }}>
            {formatTime(progress)} / {formatTime(duration)}
          </span>
          <button onClick={toggleMute} className="p-2 hover:opacity-80">
            {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={muted ? 0 : volume}
            onChange={(e) => setVolume(Number(e.target.value))}
            className="w-20 accent-[#1db954]"
          />
        </div>
      </div>
    </div>
  );
}
