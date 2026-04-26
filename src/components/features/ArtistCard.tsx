import { Link } from 'react-router-dom';
import { User } from 'lucide-react';
import type { Artist } from '@/types';
import { Card, CardContent } from '@/components/ui/Card';

interface ArtistCardProps {
  artist: Artist;
}

export function ArtistCard({ artist }: ArtistCardProps) {
  return (
    <Link
      to={`/artist/${artist.id}`}
      className="group block transition-transform duration-300 hover:-translate-y-1"
    >
      <Card className="border-transparent bg-card/70 transition-all duration-300 group-hover:border-primary/30 group-hover:shadow-[var(--shadow-glow)]">
        <CardContent className="flex flex-col items-center gap-3 p-4 text-center">
          {artist.imageUrl ? (
            <img
              src={artist.imageUrl}
              alt={artist.name}
              className="h-24 w-24 rounded-full object-cover ring-4 ring-primary/10 transition-transform duration-500 group-hover:scale-105"
            />
          ) : (
            <div className="flex h-24 w-24 items-center justify-center rounded-full bg-secondary ring-4 ring-primary/10">
              <User size={32} className="text-muted-foreground" />
            </div>
          )}
          <p className="w-full truncate text-sm font-semibold">{artist.name}</p>
        </CardContent>
      </Card>
    </Link>
  );
}
