import { Loader2 } from 'lucide-react';
import type { SearchResult, Track } from '@/types';
import { TrackItem } from './TrackItem';
import { AlbumCard } from './AlbumCard';
import { ArtistCard } from './ArtistCard';

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
      <div className="flex items-center justify-center py-12">
        <Loader2 size={24} className="animate-spin" style={{ color: 'var(--color-accent)' }} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="py-12 text-center">
        <p style={{ color: 'var(--color-danger)' }}>Ошибка поиска</p>
      </div>
    );
  }

  if (!data) return null;

  const hasTracks = data.tracks.length > 0;
  const hasAlbums = data.albums.length > 0;
  const hasArtists = data.artists.length > 0;

  if (!hasTracks && !hasAlbums && !hasArtists) {
    return (
      <div className="py-12 text-center">
        <p style={{ color: 'var(--color-text-muted)' }}>Ничего не найдено</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      {(filter === 'all' || filter === 'tracks') && hasTracks && (
        <section>
          {filter === 'all' && <h2 className="text-lg font-bold mb-3">Треки</h2>}
          <div className="flex flex-col">
            {data.tracks.map((track, i) => (
              <TrackItem key={track.id} track={track} index={i} onPlay={onPlayTrack} />
            ))}
          </div>
        </section>
      )}

      {(filter === 'all' || filter === 'albums') && hasAlbums && (
        <section>
          {filter === 'all' && <h2 className="text-lg font-bold mb-3">Альбомы</h2>}
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
            {data.albums.map((album) => (
              <AlbumCard key={album.id} album={album} />
            ))}
          </div>
        </section>
      )}

      {(filter === 'all' || filter === 'artists') && hasArtists && (
        <section>
          {filter === 'all' && <h2 className="text-lg font-bold mb-3">Артисты</h2>}
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3">
            {data.artists.map((artist) => (
              <ArtistCard key={artist.id} artist={artist} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
