import { AlertCircle, Loader2, Music2, Sparkles } from 'lucide-react';
import type { SearchResult, Track } from '@/types';
import { TrackItem } from './TrackItem';
import { AlbumCard } from './AlbumCard';
import { ArtistCard } from './ArtistCard';
import { Card, CardContent } from '@/components/ui/Card';
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
      <div className="animate-enter flex flex-col gap-8">
        <section className="glass-panel rounded-[var(--radius-xl)] p-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <TrackSkeleton key={i} />
          ))}
        </section>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <AlbumSkeleton key={i} />
          ))}
        </div>
        <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 size={16} className="animate-spin text-primary" />
          Ищем музыку в Tidal...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <Card className="animate-enter border-[var(--color-danger-muted)]">
        <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
          <AlertCircle size={40} className="text-[var(--color-danger)]" />
          <div>
            <p className="text-lg font-semibold">Поиск не сработал</p>
            <p className="mt-1 max-w-xl text-sm text-muted-foreground">{error.message}</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!data) return null;

  const hasTracks = data.tracks.length > 0;
  const hasAlbums = data.albums.length > 0;
  const hasArtists = data.artists.length > 0;

  if (!hasTracks && !hasAlbums && !hasArtists) {
    return (
      <Card className="animate-enter">
        <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
          <Music2 size={42} className="text-muted-foreground" />
          <div>
            <p className="text-lg font-semibold">Ничего не найдено</p>
            <p className="text-sm text-muted-foreground">Попробуйте другой запрос или смените фильтр.</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="animate-enter flex flex-col gap-10">
      {(filter === 'all' || filter === 'tracks') && hasTracks && (
        <section>
          {filter === 'all' && <SectionTitle title="Треки" subtitle={`${data.tracks.length} найдено`} />}
          <div className="glass-panel flex flex-col overflow-hidden rounded-[var(--radius-xl)] p-2">
            {data.tracks.map((track, i) => (
              <TrackItem key={track.id} track={track} index={i} onPlay={onPlayTrack} />
            ))}
          </div>
        </section>
      )}

      {(filter === 'all' || filter === 'albums') && hasAlbums && (
        <section>
          {filter === 'all' && <SectionTitle title="Альбомы" subtitle="Релизы и синглы" />}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
            {data.albums.map((album) => (
              <AlbumCard key={album.id} album={album} />
            ))}
          </div>
        </section>
      )}

      {(filter === 'all' || filter === 'artists') && hasArtists && (
        <section>
          {filter === 'all' && <SectionTitle title="Артисты" subtitle="Лучшие совпадения" />}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-5 xl:grid-cols-6">
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
    <div className="mb-4 flex items-end justify-between gap-4">
      <div>
        <div className="flex items-center gap-2 text-primary">
          <Sparkles size={16} />
          <span className="text-xs font-bold uppercase tracking-[0.24em]">Tidal</span>
        </div>
        <h2 className="mt-1 text-2xl font-bold">{title}</h2>
      </div>
      <p className="hidden text-sm text-muted-foreground sm:block">{subtitle}</p>
    </div>
  );
}
