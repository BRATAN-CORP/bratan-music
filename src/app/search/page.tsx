import { useEffect, useState } from 'react';
import { SearchBar } from '@/components/features/SearchBar';
import { SearchFilters } from '@/components/features/SearchFilters';
import { SearchResults } from '@/components/features/SearchResults';
import { SearchEmptyState } from '@/components/features/SearchEmptyState';
import { AuthGuard } from '@/components/features/AuthGuard';
import { useSearch } from '@/hooks/useSearch';
import { useRecentSearches } from '@/hooks/useRecentSearches';
import { usePlayerStore } from '@/store/player';
import type { Track } from '@/types';

type SearchFilter = 'all' | 'tracks' | 'albums' | 'artists';

export function SearchPage() {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<SearchFilter>('all');
  const { data, isLoading, error } = useSearch(query, filter);
  const setTrack = usePlayerStore((s) => s.setTrack);
  const setQueue = usePlayerStore((s) => s.setQueue);
  const recent = useRecentSearches();

  // Persist a recent query once the search yields any usable result, so we
  // don't store typos that produced an empty payload.
  useEffect(() => {
    if (!query) return;
    if (!data) return;
    const hasAny = data.tracks.length || data.albums.length || data.artists.length;
    if (hasAny) recent.push(query);
  }, [data, query, recent]);

  const handlePlayTrack = (track: Track) => {
    setTrack({
      id: track.id,
      title: track.title,
      artist: track.artist,
      artistId: track.artistId,
      coverUrl: track.coverUrl, coverVideoUrl: track.coverVideoUrl,
      duration: track.duration,
    });
    if (data?.tracks) {
      setQueue(
        data.tracks.map((t) => ({
          id: t.id,
          title: t.title,
          artist: t.artist,
          artistId: t.artistId,
          coverUrl: t.coverUrl,
          duration: t.duration,
        }))
      );
    }
  };

  const showEmptyState = !query.trim();

  return (
    <AuthGuard>
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-4 sm:p-6 lg:p-10">
        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium uppercase tracking-[0.25em] text-muted-foreground">Поиск</span>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Найдите треки, альбомы и артистов</h1>
        </div>
        <SearchBar value={query} onChange={setQuery} />
        {!showEmptyState && <SearchFilters active={filter} onChange={setFilter} />}
        {showEmptyState ? (
          <SearchEmptyState
            recent={recent.items}
            onPick={(q) => setQuery(q)}
            onRemove={recent.remove}
            onClear={recent.clear}
          />
        ) : (
          <SearchResults
            data={data}
            isLoading={isLoading}
            error={error}
            filter={filter}
            onPlayTrack={handlePlayTrack}
          />
        )}
      </div>
    </AuthGuard>
  );
}
