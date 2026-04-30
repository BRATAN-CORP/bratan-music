import { Link } from 'react-router-dom';
import { motion } from 'motion/react';
import type { Artist } from '@/types';
import { CoverFallback } from '@/components/ui/CoverFallback';

interface ArtistCardProps {
  artist: Artist;
}

export function ArtistCard({ artist }: ArtistCardProps) {
  // Some Tidal artists carry a stale `imageUrl` whose CDN object has
  // since been deleted — the URL is truthy but the response is 404.
  // CoverFallback handles the onError swap to a coloured-initials
  // tile (same look as everywhere else: search, onboarding, uploads).
  return (
    <Link to={`/artist/${artist.id}`} className="group flex flex-col items-center gap-2.5 text-center">
      <motion.div
        whileHover={{ scale: 1.04 }}
        transition={{ type: 'spring', stiffness: 320, damping: 22 }}
        className="relative h-24 w-24 overflow-hidden rounded-full border border-border bg-secondary"
      >
        <CoverFallback
          src={artist.imageUrl}
          name={artist.name}
          initialsClassName="text-xl"
        />
        <div className="pointer-events-none absolute inset-0 rounded-full ring-0 ring-[var(--color-accent-glow)] transition-all duration-300 group-hover:ring-8" />
      </motion.div>
      <p className="w-full truncate text-sm font-medium">{artist.name}</p>
    </Link>
  );
}
