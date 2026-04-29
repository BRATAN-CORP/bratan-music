import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { SearchResult } from '@/types';

type SearchFilter = 'all' | 'tracks' | 'albums' | 'artists';

/**
 * Combined search used by the landing/all-filter view. Returns only
 * the first window of results from the upstream (25 per bucket by
 * default) — the intent is a preview; the per-filter view below
 * handles infinite scroll for the "Смотреть все" experience.
 */
export function useSearch(query: string, filter: SearchFilter = 'all') {
  return useQuery({
    queryKey: ['search', query, filter],
    queryFn: () => api.get<SearchResult>(`/search?q=${encodeURIComponent(query)}&filter=${filter}`),
    enabled: query.length >= 2,
    staleTime: 1000 * 60 * 2,
  });
}

/**
 * Infinite-scroll search used by the dedicated filter views
 * (tracks / albums / artists). Each page asks the worker for a
 * 50-item window, and pagination stops either when we've reached
 * the upstream-reported total or the server returns fewer items
 * than we asked for. The bucket to page through is derived from
 * the filter.
 */
const SEARCH_PAGE_SIZE = 50;

export function useSearchInfinite(query: string, filter: Exclude<SearchFilter, 'all'>) {
  return useInfiniteQuery({
    queryKey: ['search-infinite', query, filter],
    initialPageParam: 0,
    enabled: query.length >= 2,
    queryFn: async ({ pageParam }) => {
      const qs = new URLSearchParams({
        q: query,
        filter,
        limit: String(SEARCH_PAGE_SIZE),
        offset: String(pageParam),
      });
      return api.get<SearchResult>(`/search?${qs.toString()}`);
    },
    getNextPageParam: (lastPage, allPages) => {
      const bucketKey = filter === 'tracks' ? 'tracks' : filter === 'albums' ? 'albums' : 'artists';
      const totalKey =
        filter === 'tracks' ? 'totalTracks' : filter === 'albums' ? 'totalAlbums' : 'totalArtists';
      const loaded = allPages.reduce(
        (sum, p) => sum + ((p[bucketKey] as unknown[])?.length ?? 0),
        0,
      );
      const total = lastPage[totalKey];
      if (typeof total === 'number' && loaded >= total) return undefined;
      const lastCount = (lastPage[bucketKey] as unknown[])?.length ?? 0;
      if (lastCount < SEARCH_PAGE_SIZE) return undefined;
      return loaded;
    },
    staleTime: 1000 * 60 * 2,
  });
}
