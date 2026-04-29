import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { Track, Album, Artist } from '@/types';

const PAGE_SIZE = 50;

interface AlbumDetail extends Album {
  tracks: Track[];
}

interface ArtistDetail extends Artist {
  topTracks: Track[];
  albums: Album[];
  singles: Album[];
  /** Total album count reported by Tidal's editorial artist-page
   *  module. Lets the artist page show "Показать все →" without
   *  guessing from the small first-window slice. */
  albumsMoreTotal?: number;
  singlesMoreTotal?: number;
  similarArtists: Artist[];
}

export function useTrack(id: string) {
  return useQuery({
    queryKey: ['track', id],
    queryFn: () => api.get<Track>(`/tracks/${id}`),
    enabled: !!id,
  });
}

export function useTrackRadio(id: string) {
  return useQuery({
    queryKey: ['track-radio', id],
    queryFn: () => api.get<{ items: Track[] }>(`/tracks/${id}/radio`),
    enabled: !!id,
  });
}

export function useAlbum(id: string) {
  return useQuery({
    queryKey: ['album', id],
    queryFn: () => api.get<AlbumDetail>(`/albums/${id}`),
    enabled: !!id,
  });
}

export function useArtist(id: string) {
  return useQuery({
    queryKey: ['artist', id],
    queryFn: () => api.get<ArtistDetail>(`/artists/${id}`),
    enabled: !!id,
  });
}

interface ArtistReleasesPage {
  items: Album[];
  totalItems?: number;
  morePath?: string;
}

interface ArtistReleasesPageContext {
  offset: number;
  morePath?: string;
}

/**
 * Cursor-paginated album feed for an artist's "see all" page. Backed
 * by `/artists/:id/albums?offset=N&limit=50`. Once the worker exposes
 * a `morePath` (Tidal's opaque dataApiPath for the artist page
 * module), subsequent pages route through it so we stay in lockstep
 * with whatever Tidal is paginating server-side.
 */
function useArtistReleasesInfinite(kind: 'albums' | 'singles', id: string) {
  return useInfiniteQuery({
    queryKey: [`artist-${kind}`, id] as const,
    enabled: !!id,
    initialPageParam: { offset: 0 } as ArtistReleasesPageContext,
    queryFn: async ({ pageParam }: { pageParam: ArtistReleasesPageContext }) => {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(pageParam.offset) });
      if (pageParam.morePath) params.set('morePath', pageParam.morePath);
      return api.get<ArtistReleasesPage>(`/artists/${id}/${kind}?${params}`);
    },
    getNextPageParam: (lastPage: ArtistReleasesPage, pages: ArtistReleasesPage[]): ArtistReleasesPageContext | undefined => {
      const loaded = pages.reduce((n, p) => n + p.items.length, 0);
      const total = lastPage.totalItems ?? loaded;
      if (loaded >= total || lastPage.items.length === 0) return undefined;
      return { offset: loaded, morePath: lastPage.morePath };
    },
    staleTime: 1000 * 60 * 5,
  });
}

export function useArtistAlbumsInfinite(id: string) {
  return useArtistReleasesInfinite('albums', id);
}

export function useArtistSinglesInfinite(id: string) {
  return useArtistReleasesInfinite('singles', id);
}

/**
 * Tidal "artist radio" — a seeded mix anchored to the given artist.
 * Backed by `/artists/:id/radio` and rendered as its own section on
 * the artist page. The endpoint resolves to an empty list on upstream
 * errors so the rest of the page keeps working.
 */
export function useArtistRadio(id: string) {
  return useQuery({
    queryKey: ['artist-radio', id],
    queryFn: () => api.get<{ items: Track[] }>(`/artists/${id}/radio`),
    enabled: !!id,
  });
}
