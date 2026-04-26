import { Play, Heart, MoreHorizontal } from 'lucide-react';
import type { Track } from '@/types';

interface TrackItemProps {
  track: Track;
  index?: number;
  onPlay?: (track: Track) => void;
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function TrackItem({ track, index, onPlay }: TrackItemProps) {
  return (
    <div
      className="flex items-center gap-3 p-2 rounded-lg hover:opacity-90 transition-colors group cursor-pointer"
      style={{ backgroundColor: 'transparent' }}
      onClick={() => onPlay?.(track)}
      onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--color-bg-subtle)')}
      onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
    >
      <div className="w-10 h-10 flex items-center justify-center flex-shrink-0">
        {track.coverUrl ? (
          <div className="relative w-10 h-10">
            <img src={track.coverUrl} alt="" className="w-10 h-10 rounded object-cover" />
            <div className="absolute inset-0 flex items-center justify-center bg-black/40 rounded opacity-0 group-hover:opacity-100 transition-opacity">
              <Play size={16} fill="white" color="white" />
            </div>
          </div>
        ) : (
          <span className="text-sm" style={{ color: 'var(--color-text-subtle)' }}>
            {index !== undefined ? index + 1 : '♪'}
          </span>
        )}
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{track.title}</p>
        <p className="text-xs truncate" style={{ color: 'var(--color-text-muted)' }}>
          {track.artist}
        </p>
      </div>

      <span className="text-xs flex-shrink-0" style={{ color: 'var(--color-text-subtle)' }}>
        {formatDuration(track.duration)}
      </span>

      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button className="p-1.5 hover:opacity-70" onClick={(e) => e.stopPropagation()}>
          <Heart size={14} style={{ color: 'var(--color-text-subtle)' }} />
        </button>
        <button className="p-1.5 hover:opacity-70" onClick={(e) => e.stopPropagation()}>
          <MoreHorizontal size={14} style={{ color: 'var(--color-text-subtle)' }} />
        </button>
      </div>
    </div>
  );
}
