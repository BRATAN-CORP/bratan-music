import { Link } from 'react-router-dom';
import { User } from 'lucide-react';
import type { Artist } from '@/types';

interface ArtistCardProps {
  artist: Artist;
}

export function ArtistCard({ artist }: ArtistCardProps) {
  return (
    <Link
      to={`/artist/${artist.id}`}
      className="flex flex-col items-center gap-2 p-3 text-center"
    >
      {artist.imageUrl ? (
        <img
          src={artist.imageUrl}
          alt={artist.name}
          className="w-24 h-24 rounded-full object-cover"
        />
      ) : (
        <div
          className="w-24 h-24 rounded-full flex items-center justify-center"
          style={{ backgroundColor: 'var(--color-bg-muted)' }}
        >
          <User size={32} style={{ color: 'var(--color-text-subtle)' }} />
        </div>
      )}
      <p className="text-sm font-medium truncate w-full">{artist.name}</p>
    </Link>
  );
}
