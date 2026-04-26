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
      className="flex items-center gap-3 p-3 rounded-xl transition-colors"
      style={{ backgroundColor: 'var(--color-surface-raised)' }}
    >
      <div
        className="w-12 h-12 rounded-lg flex items-center justify-center flex-shrink-0"
        style={{
          backgroundColor: playlist.isLiked ? 'var(--color-accent-muted)' : 'var(--color-bg-muted)',
        }}
      >
        {playlist.isLiked ? (
          <Heart size={20} fill="var(--color-accent)" style={{ color: 'var(--color-accent)' }} />
        ) : (
          <ListMusic size={20} style={{ color: 'var(--color-text-subtle)' }} />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium truncate">{playlist.name}</p>
        <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
          {playlist.trackCount} {playlist.trackCount === 1 ? 'трек' : 'треков'}
        </p>
      </div>
    </Link>
  );
}
