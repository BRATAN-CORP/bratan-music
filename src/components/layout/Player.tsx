import { Play, Pause, SkipBack, SkipForward, Volume2, VolumeX } from 'lucide-react';
import { usePlayerStore } from '@/store/player';

export function Player() {
  const { currentTrack, isPlaying, togglePlay, next, previous, muted, toggleMute } = usePlayerStore();

  if (!currentTrack) return null;

  return (
    <div
      className="fixed bottom-14 lg:bottom-0 left-0 right-0 flex items-center gap-4 px-4 z-30 border-t"
      style={{
        height: 'var(--player-height)',
        backgroundColor: 'var(--player-bg)',
        borderColor: 'var(--player-border)',
      }}
    >
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

      <div className="flex items-center gap-2">
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
      </div>

      <div className="hidden md:flex items-center gap-2 flex-1 justify-end">
        <button onClick={toggleMute} className="p-2 hover:opacity-80">
          {muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
        </button>
      </div>
    </div>
  );
}
