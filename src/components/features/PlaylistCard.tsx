import { Link } from 'react-router-dom';
import { ListMusic, Heart } from 'lucide-react';
import type { Playlist } from '@/types';

interface PlaylistCardProps {
  playlist: Playlist;
}

export function PlaylistCard({ playlist }: PlaylistCardProps) {
  return (
    <Link
      to={`/playlist/${playlist.id}`}
      className="flex items-center gap-4 border border-border bg-card px-4 py-3 transition-colors hover:bg-secondary rounded-[var(--radius-md)]"
    >
      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[var(--radius-sm)] border border-border bg-background text-muted-foreground">
        {playlist.isLiked ? <Heart size={18} fill="currentColor" /> : <ListMusic size={18} />}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{playlist.name}</p>
        <p className="text-xs text-muted-foreground">
          {playlist.trackCount} {playlist.trackCount === 1 ? 'трек' : 'треков'}
        </p>
      </div>
    </Link>
  );
}
