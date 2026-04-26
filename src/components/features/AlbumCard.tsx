import { Link } from 'react-router-dom';
import { Disc3 } from 'lucide-react';
import type { Album } from '@/types';

interface AlbumCardProps {
  album: Album;
}

export function AlbumCard({ album }: AlbumCardProps) {
  return (
    <Link to={`/album/${album.id}`} className="group flex flex-col gap-2">
      {album.coverUrl ? (
        <img
          src={album.coverUrl}
          alt={album.title}
          className="aspect-square w-full rounded-[var(--radius-md)] border border-border object-cover transition-opacity group-hover:opacity-90"
          loading="lazy"
        />
      ) : (
        <div className="flex aspect-square w-full items-center justify-center rounded-[var(--radius-md)] border border-border bg-secondary">
          <Disc3 size={28} className="text-muted-foreground" />
        </div>
      )}
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{album.title}</p>
        <p className="truncate text-xs text-muted-foreground">{album.artist}</p>
      </div>
    </Link>
  );
}
