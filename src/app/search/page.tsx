import { useState } from 'react';
import { SearchBar } from '@/components/features/SearchBar';
import { SearchFilters } from '@/components/features/SearchFilters';
import { SearchResults } from '@/components/features/SearchResults';
import { AuthGuard } from '@/components/features/AuthGuard';
import { useSearch } from '@/hooks/useSearch';
import { usePlayerStore } from '@/store/player';
import type { Track } from '@/types';

type SearchFilter = 'all' | 'tracks' | 'albums' | 'artists';

export function SearchPage() {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<SearchFilter>('all');
  const { data, isLoading, error } = useSearch(query, filter);
  const setTrack = usePlayerStore((s) => s.setTrack);
  const setQueue = usePlayerStore((s) => s.setQueue);

  const handlePlayTrack = (track: Track) => {
    setTrack({
      id: track.id,
      title: track.title,
      artist: track.artist,
      coverUrl: track.coverUrl,
      duration: track.duration,
    });
    if (data?.tracks) {
      setQueue(
        data.tracks.map((t) => ({
          id: t.id,
          title: t.title,
          artist: t.artist,
          coverUrl: t.coverUrl,
          duration: t.duration,
        }))
      );
    }
  };

  return (
    <AuthGuard>
      <div className="p-6 flex flex-col gap-4">
        <h1 className="text-2xl font-bold">Поиск</h1>
        <SearchBar value={query} onChange={setQuery} />
        {query && <SearchFilters active={filter} onChange={setFilter} />}
        <SearchResults
          data={data}
          isLoading={isLoading}
          error={error}
          filter={filter}
          onPlayTrack={handlePlayTrack}
        />
      </div>
    </AuthGuard>
  );
}
