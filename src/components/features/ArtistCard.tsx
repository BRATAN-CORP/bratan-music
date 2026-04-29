import { useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'motion/react';
import type { Artist } from '@/types';

interface ArtistCardProps {
  artist: Artist;
}

/**
 * Build initials from an artist name. Splits on whitespace, takes
 * the first character of up to two leading words, uppercases. We
 * keep this lightweight rather than reach for a library — names are
 * already cleaned upstream.
 */
function artistInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const [first, second] = words;
  if (!first) return '?';
  if (!second) return first.slice(0, 2).toUpperCase();
  return ((first[0] ?? '') + (second[0] ?? '')).toUpperCase();
}

/**
 * Stable per-name hue. Lets the fallback tile feel like a unique
 * avatar instead of a generic gray placeholder, while staying within
 * the theme's accent range.
 */
function fallbackHue(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return Math.abs(hash) % 360;
}

export function ArtistCard({ artist }: ArtistCardProps) {
  // Some Tidal artists carry a stale `imageUrl` whose CDN object has
  // since been deleted — the URL is truthy but the response is 404.
  // Without an `onError` swap the browser would render its native
  // broken-image glyph (the small square with a "?"), which the
  // user explicitly reported as "не вижу фолбека". Track load
  // failure and fall through to the initials tile below.
  const [imgFailed, setImgFailed] = useState(false);
  const showImage = !!artist.imageUrl && !imgFailed;
  const initials = artistInitials(artist.name);
  const hue = fallbackHue(artist.name);
  return (
    <Link to={`/artist/${artist.id}`} className="group flex flex-col items-center gap-2.5 text-center">
      <motion.div
        whileHover={{ scale: 1.04 }}
        transition={{ type: 'spring', stiffness: 320, damping: 22 }}
        className="relative h-24 w-24 overflow-hidden rounded-full border border-border bg-secondary"
      >
        {showImage ? (
          <img
            src={artist.imageUrl}
            alt={artist.name}
            className="h-full w-full object-cover"
            loading="lazy"
            onError={() => setImgFailed(true)}
          />
        ) : (
          <div
            className="flex h-full w-full items-center justify-center text-xl font-semibold tracking-wide text-white"
            style={{
              background: `radial-gradient(120% 120% at 30% 25%, hsl(${hue} 65% 45% / 0.95), hsl(${(hue + 40) % 360} 55% 22%))`,
            }}
            aria-label={artist.name}
          >
            {initials}
          </div>
        )}
        <div className="pointer-events-none absolute inset-0 rounded-full ring-0 ring-[var(--color-accent-glow)] transition-all duration-300 group-hover:ring-8" />
      </motion.div>
      <p className="w-full truncate text-sm font-medium">{artist.name}</p>
    </Link>
  );
}
