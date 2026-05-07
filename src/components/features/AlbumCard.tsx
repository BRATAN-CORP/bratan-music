import { Link } from 'react-router-dom';
import { Disc3 } from 'lucide-react';
import type { Album } from '@/types';
import { TiltCard } from '@/components/ui/TiltCard';
import { AlbumPlayButton } from '@/components/features/AlbumPlayButton';
import { CardDownloadOverlay } from '@/components/features/CardDownloadOverlay';
import { useOfflineCoverUrl } from '@/hooks/useOfflineCoverUrl';
import { useT } from '@/i18n';

interface AlbumCardProps {
  album: Album;
}

export function AlbumCard({ album }: AlbumCardProps) {
  const t = useT();
  // Prefer the locally-cached cover blob when the album is saved
  // offline so the tile renders even with the network down. Falls
  // back to the network URL for non-saved albums and to the `Disc3`
  // placeholder when both are missing.
  const coverUrl = useOfflineCoverUrl('album', album.id, album.coverUrl);
  return (
    <Link to={`/album/${album.id}`} className="group flex flex-col gap-2.5">
      <TiltCard intensity={6} className="aspect-square w-full rounded-[var(--radius-md)]">
        <div className="relative aspect-square w-full overflow-hidden rounded-[var(--radius-md)] border border-border bg-secondary">
          {coverUrl ? (
            <img
              src={coverUrl}
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
          <AlbumPlayButton
            albumId={album.id}
            albumTitle={album.title}
            className="absolute bottom-2 right-2 flex h-9 w-9 translate-y-3 items-center justify-center rounded-full bg-[var(--color-accent)] text-[var(--color-text-on-accent)] opacity-0 shadow-lg transition-all duration-300 group-hover:translate-y-0 group-hover:opacity-100 disabled:cursor-progress"
          />
          {/* Live download progress shown on top of the cover while
              the album is being saved offline. Mirrors the dynamic
              ring the user already sees on individual track rows. */}
          <CardDownloadOverlay kind="album" id={album.id} />
        </div>
      </TiltCard>
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{album.title}</p>
        <p className="truncate text-xs text-muted-foreground">
          {album.releaseType && album.releaseType !== 'ALBUM' && album.releaseType !== 'SINGLE' ? (
            <span className="mr-1.5 rounded border border-border px-1 py-px text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/90">
              {album.releaseType === 'COMPILATION' ? t('album.compilation') : album.releaseType}
            </span>
          ) : null}
          {album.artist}
        </p>
      </div>
    </Link>
  );
}
