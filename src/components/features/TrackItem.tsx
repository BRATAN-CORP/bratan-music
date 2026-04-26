import { Heart, MoreHorizontal, Play } from 'lucide-react';
import type { Track } from '@/types';
import { Button } from '@/components/ui/Button';

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
      className="group flex cursor-pointer items-center gap-3 rounded-2xl p-2 transition-all duration-200 hover:bg-secondary/80"
      onClick={() => onPlay?.(track)}
    >
      <div className="w-10 h-10 flex items-center justify-center flex-shrink-0">
        {track.coverUrl ? (
          <div className="relative h-12 w-12 overflow-hidden rounded-xl shadow-[var(--shadow-sm)]">
            <img src={track.coverUrl} alt="" className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-110" />
            <div className="absolute inset-0 flex items-center justify-center bg-[var(--color-media-overlay)] opacity-0 transition-opacity group-hover:opacity-100">
              <Play size={16} fill="currentColor" className="text-[var(--color-text-on-accent)]" />
            </div>
          </div>
        ) : (
          <span className="text-sm text-muted-foreground">
            {index !== undefined ? index + 1 : '♪'}
          </span>
        )}
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{track.title}</p>
        <p className="text-xs truncate text-muted-foreground">
          {track.artist}
        </p>
      </div>

      <span className="hidden flex-shrink-0 text-xs text-muted-foreground sm:block">
        {formatDuration(track.duration)}
      </span>

      <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={(e) => e.stopPropagation()}>
          <Heart size={14} />
        </Button>
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={(e) => e.stopPropagation()}>
          <MoreHorizontal size={14} />
        </Button>
      </div>
    </div>
  );
}
