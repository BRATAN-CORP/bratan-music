import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { enqueueSync } from '@/lib/offline/syncQueue';
import { getSavedPlaylistWithTracks } from '@/lib/offline/storage';
import { networkOrLocal } from '@/lib/offline/networkOrLocal';
import type { Track, Playlist, ArtistRef } from '@/types';

/** Treat the device as offline if `navigator.onLine` is false. The
 *  flag is famously imprecise but the queue replay path is
 *  idempotent enough that a stale "online" status just means we'll
 *  attempt a network call, fail, and the user retries — same UX
 *  they'd get on a working connection that returned a transient
 *  error. */
function isOffline(): boolean {
  return typeof navigator !== 'undefined' && !navigator.onLine;
}

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
  /** Primary artist id — used as a fallback when `artists` is empty. */
  artistId?: string;
  /** Full credit list. Persisted into the snapshot so saved tracks keep
   *  per-contributor links across reloads (Drake & Future, etc.). */
  artists?: ArtistRef[];
  album?: string;
  coverUrl?: string;
  /** Animated mp4 cover URL (Tidal). Persisted into the like-snapshot
   *  so liked / playlist tracks keep the animated cover in fullscreen. */
  coverVideoUrl?: string;
  duration: number;
}

type TrackSnapshot = Pick<
  LikeableTrack,
  'title' | 'artist' | 'artistId' | 'artists' | 'album' | 'coverUrl' | 'coverVideoUrl' | 'duration'
>;

function snapshotOf(t: LikeableTrack): TrackSnapshot {
  return {
    title: t.title,
    artist: t.artist,
    artistId: t.artistId,
    artists: t.artists,
    album: t.album ?? '',
    coverUrl: t.coverUrl,
    coverVideoUrl: t.coverVideoUrl,
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
  const qc = useQueryClient();
  return useQuery({
    queryKey: ['playlist', id],
    // `networkOrLocal` returns whichever resolves first within a
    // 5-second budget — saved playlists hydrate from IDB instantly
    // when the network is unreachable instead of waiting for the
    // browser-default ~60-second `fetch` timeout. User report:
    // "офлайн: скачанные плейлисты не открываются". `navigator.onLine`
    // is too unreliable on Telegram WebView / mobile to be the only
    // signal, so we race and fall back regardless.
    queryFn: () =>
      networkOrLocal(
        async () => {
          const data = await api.get<PlaylistWithTracks>(`/playlists/${id}`);
          // Detail-view fetch refreshes the backend's cached
          // `source_track_count` for linked playlists. Invalidate
          // the library list so the card count picks up the freshly
          // cached value on next render — otherwise the user sees
          // the correct count on the detail page but a stale 0
          // back on the Library tab.
          if (data?.sourceKind) {
            qc.invalidateQueries({ queryKey: ['playlists'] });
          }
          return data;
        },
        async () => (await getSavedPlaylistWithTracks(id)) as PlaylistWithTracks | null,
      ),
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
    onSuccess: () => qc.invalidateQueries({ queryKey: ['playlists'] }),
  });
}

export function useSetPlaylistCover() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, dataUrl }: { id: string; dataUrl: string }) =>
      api.put<{ ok: boolean; coverUrl: string }>(`/playlists/${id}/cover`, { dataUrl }),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['playlists'] });
      qc.invalidateQueries({ queryKey: ['playlist', vars.id] });
    },
  });
}

export function usePinPlaylist() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, pinned }: { id: string; pinned: boolean }) =>
      api.put<{ ok: boolean; pinnedAt: number | null }>(`/playlists/${id}/pin`, { pinned }),
    onMutate: async ({ id, pinned }) => {
      await qc.cancelQueries({ queryKey: ['playlists'] });
      await qc.cancelQueries({ queryKey: ['playlist', id] });
      const prevList = qc.getQueryData<Playlist[]>(['playlists']);
      const prevDetail = qc.getQueryData<PlaylistWithTracks>(['playlist', id]);
      const newPinnedAt = pinned ? Date.now() : null;
      qc.setQueryData<Playlist[]>(['playlists'], (old) =>
        old?.map((p) =>
          p.id === id ? { ...p, pinnedAt: newPinnedAt } : p,
        ),
      );
      if (prevDetail) {
        qc.setQueryData<PlaylistWithTracks>(['playlist', id], {
          ...prevDetail,
          pinnedAt: newPinnedAt,
        });
      }
      return { prevList, prevDetail };
    },
    onError: (_err, { id }, ctx) => {
      if (ctx?.prevList) qc.setQueryData(['playlists'], ctx.prevList);
      if (ctx?.prevDetail) qc.setQueryData(['playlist', id], ctx.prevDetail);
    },
    onSettled: (_d, _e, { id }) => {
      qc.invalidateQueries({ queryKey: ['playlists'] });
      qc.invalidateQueries({ queryKey: ['playlist', id] });
    },
  });
}

export function useRemovePlaylistCover() {
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
    mutationFn: ({ playlistId, track, source }: { playlistId: string; track: LikeableTrack; source?: string }) => {
      // Upload tracks are addressed as "upload:<uuid>" client-side, but the
      // playlist_tracks table stores rawId + source separately.
      const isUpload = track.id.startsWith('upload:');
      const trackId = isUpload ? track.id.slice('upload:'.length) : track.id;
      const resolvedSource = source ?? (isUpload ? 'upload' : 'tidal');
      return api.post(`/playlists/${playlistId}/tracks`, {
        trackId,
        source: resolvedSource,
        snapshot: snapshotOf(track),
      });
    },
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
    mutationFn: async (track: LikeableTrack) => {
      const snapshot = snapshotOf(track);
      if (isOffline()) {
        // Buffer for replay. The optimistic onMutate below has
        // already updated the local liked-ids cache so the heart
        // is filled immediately.
        await enqueueSync({ kind: 'like-track', trackId: track.id, snapshot });
        return;
      }
      await api.post(`/library/like/${track.id}`, snapshot);
    },
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
    mutationFn: async (trackId: string) => {
      if (isOffline()) {
        await enqueueSync({ kind: 'unlike-track', trackId });
        return;
      }
      await api.delete(`/library/like/${trackId}`);
    },
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

// ── Album / Artist library items ─────────────────────────────────────

interface LibraryAlbumSnapshot {
  title: string;
  artist: string;
  artistId: string;
  coverUrl?: string;
}

interface LibraryArtistSnapshot {
  name: string;
  imageUrl?: string;
}

export interface LibraryAlbum extends LibraryAlbumSnapshot {
  id: string;
  addedAt: number;
}

export interface LibraryArtist extends LibraryArtistSnapshot {
  id: string;
  addedAt: number;
}

export function useLikedAlbumIds() {
  return useQuery({
    queryKey: ['library', 'album', 'ids'],
    queryFn: () => api.get<{ ids: string[] }>('/library/items/album/ids'),
    staleTime: 30_000,
  });
}

export function useLikedArtistIds() {
  return useQuery({
    queryKey: ['library', 'artist', 'ids'],
    queryFn: () => api.get<{ ids: string[] }>('/library/items/artist/ids'),
    staleTime: 30_000,
  });
}

export function useLikedAlbums() {
  return useQuery({
    queryKey: ['library', 'album'],
    queryFn: () => api.get<{ items: LibraryAlbum[] }>('/library/items/album'),
  });
}

export function useLikedArtists() {
  return useQuery({
    queryKey: ['library', 'artist'],
    queryFn: () => api.get<{ items: LibraryArtist[] }>('/library/items/artist'),
  });
}

export function useLikeAlbum() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...snapshot }: { id: string } & LibraryAlbumSnapshot) => {
      if (isOffline()) {
        await enqueueSync({ kind: 'like-album', albumId: id, snapshot });
        return;
      }
      await api.post(`/library/items/album/${id}`, snapshot);
    },
    onMutate: async ({ id }) => {
      await qc.cancelQueries({ queryKey: ['library', 'album', 'ids'] });
      const prev = qc.getQueryData<{ ids: string[] }>(['library', 'album', 'ids']);
      qc.setQueryData<{ ids: string[] }>(['library', 'album', 'ids'], (old) => ({
        ids: Array.from(new Set([...(old?.ids ?? []), id])),
      }));
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(['library', 'album', 'ids'], ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['library', 'album'] });
    },
  });
}

export function useUnlikeAlbum() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      if (isOffline()) {
        await enqueueSync({ kind: 'unlike-album', albumId: id });
        return;
      }
      await api.delete(`/library/items/album/${id}`);
    },
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ['library', 'album', 'ids'] });
      const prev = qc.getQueryData<{ ids: string[] }>(['library', 'album', 'ids']);
      qc.setQueryData<{ ids: string[] }>(['library', 'album', 'ids'], (old) => ({
        ids: (old?.ids ?? []).filter((x) => x !== id),
      }));
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(['library', 'album', 'ids'], ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['library', 'album'] });
    },
  });
}

export function useToggleAlbumLike() {
  const { data } = useLikedAlbumIds();
  const like = useLikeAlbum();
  const unlike = useUnlikeAlbum();
  const isLiked = (id: string) => data?.ids?.includes(id) ?? false;
  return {
    isLiked,
    toggle: (album: { id: string } & LibraryAlbumSnapshot) => {
      if (isLiked(album.id)) unlike.mutate(album.id);
      else like.mutate(album);
    },
    pending: like.isPending || unlike.isPending,
  };
}

export function useLikeArtist() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...snapshot }: { id: string } & LibraryArtistSnapshot) => {
      if (isOffline()) {
        await enqueueSync({ kind: 'like-artist', artistId: id, snapshot });
        return;
      }
      await api.post(`/library/items/artist/${id}`, snapshot);
    },
    onMutate: async ({ id }) => {
      await qc.cancelQueries({ queryKey: ['library', 'artist', 'ids'] });
      const prev = qc.getQueryData<{ ids: string[] }>(['library', 'artist', 'ids']);
      qc.setQueryData<{ ids: string[] }>(['library', 'artist', 'ids'], (old) => ({
        ids: Array.from(new Set([...(old?.ids ?? []), id])),
      }));
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(['library', 'artist', 'ids'], ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['library', 'artist'] });
    },
  });
}

export function useUnlikeArtist() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      if (isOffline()) {
        await enqueueSync({ kind: 'unlike-artist', artistId: id });
        return;
      }
      await api.delete(`/library/items/artist/${id}`);
    },
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ['library', 'artist', 'ids'] });
      const prev = qc.getQueryData<{ ids: string[] }>(['library', 'artist', 'ids']);
      qc.setQueryData<{ ids: string[] }>(['library', 'artist', 'ids'], (old) => ({
        ids: (old?.ids ?? []).filter((x) => x !== id),
      }));
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(['library', 'artist', 'ids'], ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['library', 'artist'] });
    },
  });
}

export function useToggleArtistLike() {
  const { data } = useLikedArtistIds();
  const like = useLikeArtist();
  const unlike = useUnlikeArtist();
  const isLiked = (id: string) => data?.ids?.includes(id) ?? false;
  return {
    isLiked,
    toggle: (artist: { id: string } & LibraryArtistSnapshot) => {
      if (isLiked(artist.id)) unlike.mutate(artist.id);
      else like.mutate(artist);
    },
    pending: like.isPending || unlike.isPending,
  };
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
