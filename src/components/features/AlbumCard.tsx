import { Link } from 'react-router-dom';
import { Disc3 } from 'lucide-react';
import type { Album } from '@/types';

interface AlbumCardProps {
  album: Album;
}

export function AlbumCard({ album }: AlbumCardProps) {
  return (
    <Link
      to={`/album/${album.id}`}
      className="flex flex-col gap-2 p-3 rounded-xl transition-colors"
      style={{ backgroundColor: 'var(--color-surface-raised)' }}
    >
      {album.coverUrl ? (
        <img
          src={album.coverUrl}
          alt={album.title}
          className="w-full aspect-square rounded-lg object-cover"
        />
      ) : (
        <div
          className="w-full aspect-square rounded-lg flex items-center justify-center"
          style={{ backgroundColor: 'var(--color-bg-muted)' }}
        >
          <Disc3 size={32} style={{ color: 'var(--color-text-subtle)' }} />
        </div>
      )}
      <div className="min-w-0">
        <p className="text-sm font-medium truncate">{album.title}</p>
        <p className="text-xs truncate" style={{ color: 'var(--color-text-muted)' }}>
          {album.artist}
        </p>
      </div>
    </Link>
  );
}
