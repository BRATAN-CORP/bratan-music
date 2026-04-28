import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { ExplorePage, Track } from '@/types';

/**
 * Fetch the top-level Tidal Explore page (genres / moods / decades
 * link clouds + a few featured rows). Cached aggressively because
 * the surface barely changes within a session.
 */
export function useExplore() {
  return useQuery({
    queryKey: ['explore'],
    queryFn: () => api.get<ExplorePage>('/explore'),
    staleTime: 1000 * 60 * 30,
    gcTime: 1000 * 60 * 60,
  });
}

/**
 * Fetch a specific Tidal page by slug — drilled into via the
 * pageLinks rows on `/explore`.
 */
export function useExplorePage(slug: string | undefined | null) {
  return useQuery({
    queryKey: ['explore-page', slug],
    queryFn: () => api.get<ExplorePage>(`/explore/page/${slug}`),
    enabled: Boolean(slug),
    staleTime: 1000 * 60 * 10,
  });
}

export function useExplorePlaylistTracks(uuid: string | undefined | null) {
  return useQuery({
    queryKey: ['explore-playlist-tracks', uuid],
    queryFn: () => api.get<{ items: Track[] }>(`/explore/playlists/${uuid}/tracks`),
    enabled: Boolean(uuid),
    staleTime: 1000 * 60 * 10,
  });
}
