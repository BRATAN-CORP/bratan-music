import { Link } from 'react-router-dom';
import { Disc3 } from 'lucide-react';
import type { Album } from '@/types';
import { Card, CardContent } from '@/components/ui/Card';

interface AlbumCardProps {
  album: Album;
}

export function AlbumCard({ album }: AlbumCardProps) {
  return (
    <Link
      to={`/album/${album.id}`}
      className="group block transition-transform duration-300 hover:-translate-y-1"
    >
      <Card className="overflow-hidden border-transparent bg-card/80 transition-all duration-300 group-hover:border-primary/30 group-hover:shadow-[var(--shadow-glow)]">
        <div className="p-3 pb-0">
          {album.coverUrl ? (
            <img
              src={album.coverUrl}
              alt={album.title}
              className="aspect-square w-full rounded-2xl object-cover shadow-[var(--shadow-md)] transition-transform duration-500 group-hover:scale-[1.03]"
            />
          ) : (
            <div className="flex aspect-square w-full items-center justify-center rounded-2xl bg-secondary">
              <Disc3 size={34} className="text-muted-foreground" />
            </div>
          )}
        </div>
        <CardContent className="min-w-0 p-4">
          <p className="truncate text-sm font-semibold">{album.title}</p>
          <p className="mt-1 truncate text-xs text-muted-foreground">{album.artist}</p>
        </CardContent>
      </Card>
    </Link>
  );
}
