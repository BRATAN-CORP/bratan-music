import { useState } from 'react';
import { Sparkles } from 'lucide-react';
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
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 p-4 sm:p-6 lg:p-8">
        <div className="animate-enter flex flex-col gap-3">
          <div className="flex items-center gap-2 text-primary">
            <Sparkles size={18} />
            <span className="text-xs font-bold uppercase tracking-[0.24em]">Tidal Search</span>
          </div>
          <div>
            <h1 className="hero-gradient-text text-4xl font-black tracking-tight sm:text-6xl">Найдите свой звук</h1>
            <p className="mt-3 max-w-2xl text-muted-foreground">
              Ищите треки, альбомы и артистов напрямую в пользовательском API Tidal.
            </p>
          </div>
        </div>
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
