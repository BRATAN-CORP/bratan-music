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
