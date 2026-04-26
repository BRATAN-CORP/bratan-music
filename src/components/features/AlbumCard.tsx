import { Link } from 'react-router-dom';
import { Disc3, Play } from 'lucide-react';
import { motion } from 'motion/react';
import type { Album } from '@/types';

interface AlbumCardProps {
  album: Album;
}

export function AlbumCard({ album }: AlbumCardProps) {
  return (
    <Link to={`/album/${album.id}`} className="group flex flex-col gap-2.5">
      <motion.div
        whileHover={{ y: -3 }}
        transition={{ type: 'spring', stiffness: 320, damping: 26 }}
        className="relative aspect-square w-full overflow-hidden rounded-[var(--radius-md)] border border-border bg-secondary"
      >
        {album.coverUrl ? (
          <img
            src={album.coverUrl}
            alt={album.title}
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <Disc3 size={28} className="text-muted-foreground" />
          </div>
        )}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
        <div className="absolute bottom-2 right-2 flex h-9 w-9 translate-y-3 items-center justify-center rounded-full bg-[var(--color-accent)] text-[var(--color-text-on-accent)] opacity-0 shadow-lg transition-all duration-300 group-hover:translate-y-0 group-hover:opacity-100">
          <Play size={14} fill="currentColor" />
        </div>
      </motion.div>
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{album.title}</p>
        <p className="truncate text-xs text-muted-foreground">{album.artist}</p>
      </div>
    </Link>
  );
}
