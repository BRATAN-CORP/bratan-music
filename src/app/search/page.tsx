import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { SearchBar } from '@/components/features/SearchBar';
import { SearchFilters } from '@/components/features/SearchFilters';
import { SearchResults } from '@/components/features/SearchResults';
import { SearchEmptyState } from '@/components/features/SearchEmptyState';
import { AuthGuard } from '@/components/features/AuthGuard';
import { Eyebrow } from '@/components/ui/SectionHeading';
import { useSearch, useSearchInfinite } from '@/hooks/useSearch';
import { useRecentSearches } from '@/hooks/useRecentSearches';
import { usePlayerStore } from '@/store/player';
import type { SearchResult, Track } from '@/types';
import { useT } from '@/i18n';

type SearchFilter = 'all' | 'tracks' | 'albums' | 'artists';

const FILTERS: readonly SearchFilter[] = ['all', 'tracks', 'albums', 'artists'];

export function SearchPage() {
  const t = useT();
  // Persist query + active filter in the URL so a reload (or a
  // bookmark / shared link) restores both. Using `useSearchParams`
  // keeps the source of truth on the URL and side-steps the extra
  // localStorage layer the previous useState approach would have
  // needed for persistence.
  const [params, setParams] = useSearchParams();
  const query = params.get('q') ?? '';
  const rawFilter = params.get('f');
  const filter: SearchFilter = (FILTERS as readonly string[]).includes(rawFilter ?? '')
    ? (rawFilter as SearchFilter)
    : 'all';
  const setQuery = useCallback(
    (next: string) => {
      setParams(
        (prev) => {
          const out = new URLSearchParams(prev);
          if (next) out.set('q', next);
          else out.delete('q');
          return out;
        },
        { replace: true },
      );
    },
    [setParams],
  );
  const setFilter = useCallback(
    (next: SearchFilter) => {
      setParams(
        (prev) => {
          const out = new URLSearchParams(prev);
          if (next === 'all') out.delete('f');
          else out.set('f', next);
          return out;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  // "all" filter uses the compact query — 25 items per bucket, no
  // pagination. The per-type filters use the infinite hook so the
  // user can scroll through the full result set instead of the
  // previous hard 25-cap.
  const combined = useSearch(query, filter === 'all' ? 'all' : 'all');
  const infinite = useSearchInfinite(
    query,
    filter === 'all' ? 'tracks' : filter, // disabled anyway when filter='all'
  );

  const isInfinite = filter !== 'all';
  const isLoading = isInfinite ? infinite.isLoading : combined.isLoading;
  const error = (isInfinite ? infinite.error : combined.error) as Error | null;

  // Flatten infinite pages into a single SearchResult so the existing
  // SearchResults component doesn't need to know about pagination.
  const data: SearchResult | undefined = useMemo(() => {
    if (!isInfinite) return combined.data;
    if (!infinite.data) return undefined;
    const out: SearchResult = { tracks: [], albums: [], artists: [] };
    for (const page of infinite.data.pages) {
      out.tracks.push(...(page.tracks ?? []));
      out.albums.push(...(page.albums ?? []));
      out.artists.push(...(page.artists ?? []));
      // Keep the most recent totals so downstream counts stay fresh.
      if (page.totalTracks !== undefined) out.totalTracks = page.totalTracks;
      if (page.totalAlbums !== undefined) out.totalAlbums = page.totalAlbums;
      if (page.totalArtists !== undefined) out.totalArtists = page.totalArtists;
    }
    return out;
  }, [isInfinite, combined.data, infinite.data]);

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
      artists: track.artists,
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
          artists: t.artists,
          coverUrl: t.coverUrl,
          coverVideoUrl: t.coverVideoUrl,
          duration: t.duration,
        }))
      );
    }
  };

  const showEmptyState = !query.trim();

  // Infinite-scroll sentinel. Only active when a single-type filter
  // is selected (otherwise the flattened `data` is a preview and
  // pagination doesn't apply).
  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!isInfinite) return;
    const el = sentinelRef.current;
    if (!el) return;
    if (!infinite.hasNextPage || infinite.isFetchingNextPage) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            infinite.fetchNextPage();
            break;
          }
        }
      },
      { rootMargin: '600px 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [isInfinite, infinite.hasNextPage, infinite.isFetchingNextPage, infinite]);

  return (
    <AuthGuard>
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-4 sm:p-6 lg:p-10">
        <div className="flex flex-col gap-2">
          <Eyebrow>{t('search.pageEyebrow')}</Eyebrow>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{t('search.pageTitle')}</h1>
        </div>
        <div data-tour-id="tour-search">
          <SearchBar value={query} onChange={setQuery} />
        </div>
        {!showEmptyState && <SearchFilters active={filter} onChange={setFilter} />}
        {showEmptyState ? (
          <SearchEmptyState
            recent={recent.items}
            onPick={(q) => setQuery(q)}
            onRemove={recent.remove}
            onClear={recent.clear}
          />
        ) : (
          <>
            <SearchResults
              data={data}
              isLoading={isLoading}
              error={error}
              filter={filter}
              onPlayTrack={handlePlayTrack}
            />
            {isInfinite && infinite.hasNextPage && (
              <div ref={sentinelRef} className="flex items-center justify-center py-6">
                {infinite.isFetchingNextPage && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 size={14} className="animate-spin" />
                    {t('search.loadingMore')}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </AuthGuard>
  );
}
