import { Link } from 'react-router-dom';
import { User } from 'lucide-react';
import { motion } from 'motion/react';
import type { Artist } from '@/types';

interface ArtistCardProps {
  artist: Artist;
}

export function ArtistCard({ artist }: ArtistCardProps) {
  return (
    <Link to={`/artist/${artist.id}`} className="group flex flex-col items-center gap-2.5 text-center">
      <motion.div
        whileHover={{ scale: 1.04 }}
        transition={{ type: 'spring', stiffness: 320, damping: 22 }}
        className="relative h-24 w-24 overflow-hidden rounded-full border border-border bg-secondary"
      >
        {artist.imageUrl ? (
          <img
            src={artist.imageUrl}
            alt={artist.name}
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <User size={28} className="text-muted-foreground" />
          </div>
        )}
        <div className="pointer-events-none absolute inset-0 rounded-full ring-0 ring-[var(--color-accent-glow)] transition-all duration-300 group-hover:ring-8" />
      </motion.div>
      <p className="w-full truncate text-sm font-medium">{artist.name}</p>
    </Link>
  );
}
