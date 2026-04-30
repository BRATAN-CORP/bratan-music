import { Link } from 'react-router-dom';
import { Play } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import type { Album } from '@/types';
import { TiltCard } from '@/components/ui/TiltCard';
import { CoverFallback } from '@/components/ui/CoverFallback';
import { fallbackGradient } from '@/lib/coverFallback';

interface AlbumCardProps {
  album: Album;
}

/**
 * Album tile with the same "cover-as-its-own-blurred-backdrop" treatment
 * as the rest of the design system (FullscreenPlayer, artist hero):
 * the artwork is laid down twice — once heavily blurred and saturated
 * to fill the card's bleed area, then again crisp and inset, sitting
 * on top with a soft drop-shadow. The blurred backing is fully
 * contained by the card's `overflow-hidden`, so it never produces the
 * ragged feathered edges the previous flat tile showed at desktop
 * widths (where `border` + `bg-secondary` met the cover at a hard
 * pixel boundary).
 *
 * Falls back to the shared coloured-initials gradient (CoverFallback)
 * when a cover URL is missing or fails to load — same look as the
 * uploaded-track fallback, so coverless user uploads stop standing
 * out as broken tiles in the grid.
 */
export function AlbumCard({ album }: AlbumCardProps) {
  const reduce = useReducedMotion();
  return (
    <Link to={`/album/${album.id}`} className="group flex flex-col gap-2.5">
      <TiltCard intensity={6} className="aspect-square w-full rounded-[var(--radius-md)]">
        <div
          className="relative aspect-square w-full overflow-hidden rounded-[var(--radius-md)] border border-border/60"
          style={!album.coverUrl ? { background: fallbackGradient(album.title || album.artist) } : undefined}
        >
          {album.coverUrl ? (
            <>
              {/* Layer 1 — blurred backdrop. `inset-[-12%]` + `scale-110`
                  guarantee the blurred sample fully covers the card
                  bleed even when the blur radius softens its edges,
                  which is what kills the "ragged edge" artefact at the
                  rounded corners. */}
              <div
                aria-hidden
                className="pointer-events-none absolute inset-[-12%] scale-110 bg-cover bg-center blur-2xl saturate-150 opacity-90"
                style={{ backgroundImage: `url(${album.coverUrl})` }}
              />
              {/* Layer 2 — soft top-down vignette to keep the title
                  area readable when the cover is bright. */}
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/10 via-transparent to-black/35" />
              {/* Layer 3 — the crisp cover, centred and inset so the
                  blurred halo feels like it's emanating from the
                  artwork itself. */}
              <motion.img
                src={album.coverUrl}
                alt={album.title}
                loading="lazy"
                className="absolute left-[10%] top-[10%] h-[80%] w-[80%] rounded-[var(--radius-sm)] object-cover shadow-[0_18px_40px_-18px_rgba(0,0,0,0.7)]"
                initial={false}
                animate={reduce ? undefined : { scale: 1 }}
                whileHover={reduce ? undefined : { scale: 1.04 }}
                transition={{ type: 'spring', stiffness: 280, damping: 24 }}
              />
            </>
          ) : (
            <CoverFallback
              src={null}
              name={album.title || album.artist || 'Album'}
              initialsClassName="text-3xl"
            />
          )}
          {/* Hover-revealed play button. Lifted via `translateZ` so it
              floats above the tilt parallax in TiltCard. */}
          <div
            className="absolute bottom-3 right-3 flex h-10 w-10 translate-y-3 items-center justify-center rounded-full bg-[var(--color-accent)] text-[var(--color-text-on-accent)] opacity-0 shadow-[0_10px_28px_-10px_var(--color-accent-glow)] transition-all duration-300 group-hover:translate-y-0 group-hover:opacity-100"
            style={{ transform: 'translateZ(30px)' }}
          >
            <Play size={14} fill="currentColor" />
          </div>
        </div>
      </TiltCard>
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{album.title}</p>
        <p className="truncate text-xs text-muted-foreground">
          {album.releaseType && album.releaseType !== 'ALBUM' && album.releaseType !== 'SINGLE' ? (
            <span className="mr-1.5 rounded border border-border px-1 py-px text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/90">
              {album.releaseType === 'COMPILATION' ? 'Сборник' : album.releaseType}
            </span>
          ) : null}
          {album.artist}
        </p>
      </div>
    </Link>
  );
}
