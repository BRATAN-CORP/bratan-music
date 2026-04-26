import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { SearchResult } from '@/types';

type SearchFilter = 'all' | 'tracks' | 'albums' | 'artists';

export function useSearch(query: string, filter: SearchFilter = 'all') {
  return useQuery({
    queryKey: ['search', query, filter],
    queryFn: () => api.get<SearchResult>(`/search?q=${encodeURIComponent(query)}&filter=${filter}`),
    enabled: query.length >= 2,
    staleTime: 1000 * 60 * 2,
  });
}
