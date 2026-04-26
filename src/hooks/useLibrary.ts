import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { Track, Playlist } from '@/types';

interface LikedResponse {
  items: Track[];
  total: number;
}

interface LikedIds { ids: string[] }

interface PlaylistWithTracks extends Playlist {
  tracks: Track[];
}

export interface LikeableTrack {
  id: string;
  title: string;
  artist: string;
  album?: string;
  coverUrl?: string;
  duration: number;
}

type TrackSnapshot = Pick<LikeableTrack, 'title' | 'artist' | 'album' | 'coverUrl' | 'duration'>;

function snapshotOf(t: LikeableTrack): TrackSnapshot {
  return {
    title: t.title,
    artist: t.artist,
    album: t.album ?? '',
    coverUrl: t.coverUrl,
    duration: t.duration,
  };
}

export function usePlaylistsList() {
  return useQuery({
    queryKey: ['playlists'],
    queryFn: async () => {
      const r = await api.get<{ items: Playlist[] } | Playlist[]>('/library/playlists');
      return Array.isArray(r) ? r : r.items;
    },
  });
}

export const usePlaylists = usePlaylistsList;

export function usePlaylist(id: string) {
  return useQuery({
    queryKey: ['playlist', id],
    queryFn: () => api.get<PlaylistWithTracks>(`/playlists/${id}`),
    enabled: !!id,
  });
}

export function useLikedTracks(limit = 50, offset = 0) {
  return useQuery({
    queryKey: ['liked', limit, offset],
    queryFn: () => api.get<LikedResponse>(`/library/liked?limit=${limit}&offset=${offset}`),
  });
}

export function useLikedIds() {
  return useQuery({
    queryKey: ['liked', 'ids'],
    queryFn: () => api.get<LikedIds>('/library/likes/ids'),
    staleTime: 30_000,
  });
}

export function useCreatePlaylist() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => api.post<Playlist>('/playlists', { name }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['playlists'] }),
  });
}

export function useDeletePlaylist() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/playlists/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['playlists'] }),
  });
}

export function useRenamePlaylist() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => api.put(`/playlists/${id}`, { name }),
    onSuccess: (_data, { id }) => {
      qc.invalidateQueries({ queryKey: ['playlists'] });
      qc.invalidateQueries({ queryKey: ['playlist', id] });
    },
  });
}

export function useDeletePlaylistCover() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/playlists/${id}/cover`),
    onSuccess: (_data, id) => {
      qc.invalidateQueries({ queryKey: ['playlists'] });
      qc.invalidateQueries({ queryKey: ['playlist', id] });
    },
  });
}

export function useAddTrackToPlaylist() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ playlistId, track, source }: { playlistId: string; track: LikeableTrack; source?: string }) =>
      api.post(`/playlists/${playlistId}/tracks`, {
        trackId: track.id,
        source: source ?? 'tidal',
        snapshot: snapshotOf(track),
      }),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['playlist', vars.playlistId] });
      qc.invalidateQueries({ queryKey: ['playlists'] });
    },
  });
}

export function useReorderPlaylistTracks() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ playlistId, trackIds }: { playlistId: string; trackIds: string[] }) =>
      api.put(`/playlists/${playlistId}/reorder`, { trackIds }),
    onMutate: async ({ playlistId, trackIds }) => {
      await qc.cancelQueries({ queryKey: ['playlist', playlistId] });
      const prev = qc.getQueryData<PlaylistWithTracks>(['playlist', playlistId]);
      if (prev) {
        const byId = new Map(prev.tracks.map((t) => [t.id, t]));
        const reordered = trackIds.map((id) => byId.get(id)).filter((t): t is Track => Boolean(t));
        qc.setQueryData<PlaylistWithTracks>(['playlist', playlistId], { ...prev, tracks: reordered });
      }
      return { prev };
    },
    onError: (_e, vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(['playlist', vars.playlistId], ctx.prev);
    },
    onSettled: (_d, _e, vars) => {
      qc.invalidateQueries({ queryKey: ['playlist', vars.playlistId] });
    },
  });
}

export function useRemoveTrackFromPlaylist() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ playlistId, trackId }: { playlistId: string; trackId: string }) =>
      api.delete(`/playlists/${playlistId}/tracks/${trackId}`),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['playlist', vars.playlistId] });
      qc.invalidateQueries({ queryKey: ['playlists'] });
      // If user removed a track from the system "Мне нравится" playlist,
      // refresh liked-state queries too.
      qc.invalidateQueries({ queryKey: ['liked'] });
    },
  });
}

export function useLikeTrack() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (track: LikeableTrack) => api.post(`/library/like/${track.id}`, snapshotOf(track)),
    onMutate: async (track) => {
      await qc.cancelQueries({ queryKey: ['liked', 'ids'] });
      const prev = qc.getQueryData<LikedIds>(['liked', 'ids']);
      qc.setQueryData<LikedIds>(['liked', 'ids'], (old) => ({
        ids: Array.from(new Set([...(old?.ids ?? []), track.id])),
      }));
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(['liked', 'ids'], ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['liked'] });
      qc.invalidateQueries({ queryKey: ['playlists'] });
      qc.invalidateQueries({ queryKey: ['playlist'] });
    },
  });
}

export function useUnlikeTrack() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (trackId: string) => api.delete(`/library/like/${trackId}`),
    onMutate: async (trackId) => {
      await qc.cancelQueries({ queryKey: ['liked', 'ids'] });
      const prev = qc.getQueryData<LikedIds>(['liked', 'ids']);
      qc.setQueryData<LikedIds>(['liked', 'ids'], (old) => ({
        ids: (old?.ids ?? []).filter((id) => id !== trackId),
      }));
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(['liked', 'ids'], ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['liked'] });
      qc.invalidateQueries({ queryKey: ['playlists'] });
      qc.invalidateQueries({ queryKey: ['playlist'] });
    },
  });
}

export function useToggleLike() {
  const { data: liked } = useLikedIds();
  const like = useLikeTrack();
  const unlike = useUnlikeTrack();
  const isLiked = (id: string) => liked?.ids?.includes(id) ?? false;
  return {
    isLiked,
    toggle: (track: LikeableTrack) => {
      if (isLiked(track.id)) unlike.mutate(track.id);
      else like.mutate(track);
    },
    pending: like.isPending || unlike.isPending,
  };
}
