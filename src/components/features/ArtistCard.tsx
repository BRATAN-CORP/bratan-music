import { Link } from 'react-router-dom';
import { User } from 'lucide-react';
import type { Artist } from '@/types';

interface ArtistCardProps {
  artist: Artist;
}

export function ArtistCard({ artist }: ArtistCardProps) {
  return (
    <Link to={`/artist/${artist.id}`} className="group flex flex-col items-center gap-2 text-center">
      {artist.imageUrl ? (
        <img
          src={artist.imageUrl}
          alt={artist.name}
          className="h-24 w-24 rounded-full border border-border object-cover transition-opacity group-hover:opacity-90"
          loading="lazy"
        />
      ) : (
        <div className="flex h-24 w-24 items-center justify-center rounded-full border border-border bg-secondary">
          <User size={28} className="text-muted-foreground" />
        </div>
      )}
      <p className="w-full truncate text-sm font-medium">{artist.name}</p>
    </Link>
  );
}
