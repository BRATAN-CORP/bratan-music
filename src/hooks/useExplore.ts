import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type {
  Album,
  Artist,
  ExploreModuleType,
  ExplorePage,
  ExplorePageLink,
  ExplorePlaylist,
  Track,
} from '@/types';

/** Tidal caps the dataApiPath pagination window at 50 items. */
const EXPLORE_LIST_PAGE_SIZE = 50;

type ExploreListItem = Track | Album | Artist | ExplorePlaylist | ExplorePageLink;

/**
 * Infinite-scroll pagination for a single explore module, backed by
 * the worker's `/explore/list` endpoint. `moreApiPath` is the opaque
 * `pagedList.dataApiPath` we carry through on ExploreModule. When
 * upstream reports a `totalItems` count, fetching stops once we've
 * collected it all; otherwise we keep requesting until a page comes
 * back short.
 */
export function useExploreList(params: {
  moreApiPath: string | undefined | null;
  type: ExploreModuleType;
}) {
  const { moreApiPath, type } = params;
  return useInfiniteQuery({
    queryKey: ['explore-list', moreApiPath, type],
    initialPageParam: 0,
    enabled: Boolean(moreApiPath),
    queryFn: async ({ pageParam }) => {
      const offset = pageParam;
      const qs = new URLSearchParams({
        path: moreApiPath!,
        type,
        limit: String(EXPLORE_LIST_PAGE_SIZE),
        offset: String(offset),
      });
      return api.get<{ items: ExploreListItem[]; totalItems?: number }>(
        `/explore/list?${qs.toString()}`,
      );
    },
    getNextPageParam: (lastPage, allPages) => {
      const loaded = allPages.reduce((sum, p) => sum + (p.items?.length ?? 0), 0);
      const total = lastPage.totalItems;
      if (typeof total === 'number' && loaded >= total) return undefined;
      if ((lastPage.items?.length ?? 0) < EXPLORE_LIST_PAGE_SIZE) return undefined;
      return loaded;
    },
    staleTime: 1000 * 60 * 5,
  });
}

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
