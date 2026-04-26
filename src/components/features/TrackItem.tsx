import { Heart, MoreHorizontal, Play } from 'lucide-react';
import { motion } from 'motion/react';
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
    <motion.div
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1], delay: Math.min((index ?? 0) * 0.025, 0.4) }}
      className="group flex cursor-pointer items-center gap-3 border-b border-border px-3 py-2 last:border-b-0 transition-colors hover:bg-secondary"
      onClick={() => onPlay?.(track)}
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center">
        {track.coverUrl ? (
          <div className="relative h-10 w-10 overflow-hidden rounded-[var(--radius-sm)]">
            <img src={track.coverUrl} alt="" className="h-full w-full object-cover" />
            <div className="absolute inset-0 hidden items-center justify-center bg-[var(--color-media-overlay)] group-hover:flex">
              <Play size={14} fill="currentColor" className="text-[var(--color-text-on-accent)]" />
            </div>
          </div>
        ) : (
          <span className="text-xs tabular-nums text-muted-foreground">
            {index !== undefined ? String(index + 1).padStart(2, '0') : '–'}
          </span>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{track.title}</p>
        <p className="truncate text-xs text-muted-foreground">{track.artist}</p>
      </div>

      <span className="hidden shrink-0 text-xs tabular-nums text-muted-foreground sm:block">
        {formatDuration(track.duration)}
      </span>

      <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={(e) => e.stopPropagation()} aria-label="Лайк">
          <Heart size={14} />
        </Button>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={(e) => e.stopPropagation()} aria-label="Ещё">
          <MoreHorizontal size={14} />
        </Button>
      </div>
    </motion.div>
  );
}
