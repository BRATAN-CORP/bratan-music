import { AlertCircle, Loader2, Music2 } from 'lucide-react';
import type { SearchResult, Track } from '@/types';
import { TrackItem } from './TrackItem';
import { AlbumCard } from './AlbumCard';
import { ArtistCard } from './ArtistCard';
import { TrackSkeleton, AlbumSkeleton } from '@/components/ui/Skeleton';

interface SearchResultsProps {
  data?: SearchResult;
  isLoading: boolean;
  error: Error | null;
  filter: string;
  onPlayTrack?: (track: Track) => void;
}

export function SearchResults({ data, isLoading, error, filter, onPlayTrack }: SearchResultsProps) {
  if (isLoading) {
    return (
      <div className="flex flex-col gap-8">
        <section className="rounded-[var(--radius-md)] border border-border bg-background">
          {Array.from({ length: 5 }).map((_, i) => (
            <TrackSkeleton key={i} />
          ))}
        </section>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <AlbumSkeleton key={i} />
          ))}
        </div>
        <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
          <Loader2 size={14} className="animate-spin" />
          Ищем в Tidal...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-[var(--radius-md)] border border-border bg-card py-14 text-center">
        <AlertCircle size={28} className="text-[var(--color-danger)]" />
        <div>
          <p className="text-base font-semibold">Поиск не сработал</p>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">{error.message}</p>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const hasTracks = data.tracks.length > 0;
  const hasAlbums = data.albums.length > 0;
  const hasArtists = data.artists.length > 0;

  if (!hasTracks && !hasAlbums && !hasArtists) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-[var(--radius-md)] border border-border bg-card py-14 text-center">
        <Music2 size={28} className="text-muted-foreground" />
        <div>
          <p className="text-base font-semibold">Ничего не найдено</p>
          <p className="text-sm text-muted-foreground">Попробуйте другой запрос или смените фильтр.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-10">
      {(filter === 'all' || filter === 'tracks') && hasTracks && (
        <section>
          {filter === 'all' && <SectionTitle title="Треки" subtitle={`${data.tracks.length} найдено`} />}
          <div className="overflow-hidden rounded-[var(--radius-md)] border border-border">
            {data.tracks.map((track, i) => (
              <TrackItem key={track.id} track={track} index={i} onPlay={onPlayTrack} />
            ))}
          </div>
        </section>
      )}

      {(filter === 'all' || filter === 'albums') && hasAlbums && (
        <section>
          {filter === 'all' && <SectionTitle title="Альбомы" subtitle="Релизы и синглы" />}
          <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
            {data.albums.map((album) => (
              <AlbumCard key={album.id} album={album} />
            ))}
          </div>
        </section>
      )}

      {(filter === 'all' || filter === 'artists') && hasArtists && (
        <section>
          {filter === 'all' && <SectionTitle title="Артисты" subtitle="Лучшие совпадения" />}
          <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 md:grid-cols-5 xl:grid-cols-6">
            {data.artists.map((artist) => (
              <ArtistCard key={artist.id} artist={artist} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function SectionTitle({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="mb-4 flex items-end justify-between gap-4 border-b border-border pb-3">
      <h2 className="text-base font-semibold tracking-tight">{title}</h2>
      <p className="hidden text-xs text-muted-foreground sm:block">{subtitle}</p>
    </div>
  );
}
