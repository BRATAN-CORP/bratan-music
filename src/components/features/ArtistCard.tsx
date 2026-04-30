import { Link } from 'react-router-dom';
import { motion, useReducedMotion } from 'motion/react';
import type { Artist } from '@/types';
import { CoverFallback } from '@/components/ui/CoverFallback';
import { fallbackGradient } from '@/lib/coverFallback';

interface ArtistCardProps {
  artist: Artist;
}

/**
 * Artist tile, redesigned to match the album card's layered aesthetic:
 * the photo is laid down twice — once blurred and saturated to fill
 * the bleed area, then again crisp and inset on top. The blur is
 * fully contained inside the round clip mask so the result no longer
 * shows the ragged feathered edge the flat circular tile produced at
 * desktop widths.
 *
 * If the artist has no usable photo we still get a colourful tile
 * (hashed-hue gradient + initials, via CoverFallback) — same shared
 * placeholder as the rest of the app.
 */
export function ArtistCard({ artist }: ArtistCardProps) {
  const reduce = useReducedMotion();
  const hasPhoto = !!artist.imageUrl;
  return (
    <Link to={`/artist/${artist.id}`} className="group flex flex-col items-center gap-2.5 text-center">
      <motion.div
        whileHover={reduce ? undefined : { scale: 1.04 }}
        transition={{ type: 'spring', stiffness: 320, damping: 22 }}
        className="relative h-24 w-24 overflow-hidden rounded-full border border-border/60"
        style={!hasPhoto ? { background: fallbackGradient(artist.name) } : undefined}
      >
        {hasPhoto ? (
          <>
            {/* Blurred halo. The 12% bleed guarantees the blur fills
                past the round clip at every corner so the ragged edge
                that previously showed up at desktop sizes is gone. */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-[-12%] scale-110 bg-cover bg-center blur-xl saturate-150 opacity-95"
              style={{ backgroundImage: `url(${artist.imageUrl})` }}
            />
            {/* Subtle inner darkening so the crisp photo on top
                pops slightly against the blurred backing. */}
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-transparent to-black/25" />
            {/* Crisp photo, inset, with a soft shadow so it feels
                like a chip floating over its own blur. */}
            <img
              src={artist.imageUrl}
              alt={artist.name}
              loading="lazy"
              className="absolute left-[10%] top-[10%] h-[80%] w-[80%] rounded-full object-cover shadow-[0_8px_22px_-10px_rgba(0,0,0,0.55)]"
            />
          </>
        ) : (
          <CoverFallback src={null} name={artist.name} initialsClassName="text-xl" />
        )}
        <div className="pointer-events-none absolute inset-0 rounded-full ring-0 ring-[var(--color-accent-glow)] transition-all duration-300 group-hover:ring-8" />
      </motion.div>
      <p className="w-full truncate text-sm font-medium">{artist.name}</p>
    </Link>
  );
}
