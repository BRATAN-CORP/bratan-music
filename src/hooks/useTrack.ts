import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { Track, Album, Artist } from '@/types';

interface AlbumDetail extends Album {
  tracks: Track[];
}

interface ArtistDetail extends Artist {
  topTracks: Track[];
  albums: Album[];
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

/**
 * Full deduped release list for an artist, used by the
 * `/artist/:id/releases` page. The worker returns every album / EP /
 * single / compilation in one shot; the page slices this list
 * client-side to stage infinite-scroll pagination.
 */
export function useArtistReleases(id: string) {
  return useQuery({
    queryKey: ['artist-releases', id],
    queryFn: () => api.get<{ items: Album[]; totalItems: number }>(`/artists/${id}/releases`),
    enabled: !!id,
    staleTime: 1000 * 60 * 5,
  });
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
