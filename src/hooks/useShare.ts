import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { Playlist, Track } from '@/types';

interface ShareResponse {
  ok: boolean;
  isPublic: boolean;
  shareToken: string | null;
}

interface SharedPlaylistResponse extends Playlist {
  tracks: Track[];
  readOnly: boolean;
  isOwner: boolean;
  owner: { name: string } | null;
  /** If the requester has already saved this playlist, the id of
   *  *their* linked copy — UI uses this to render "Открыть" instead
   *  of "Сохранить в библиотеку". */
  savedPlaylistId: string | null;
}

/**
 * Toggle a playlist's `is_public` flag. Owner-only on the server; the
 * client-side mutation just hits the endpoint and bubbles the
 * server's response. Optimistically updates the playlist detail
 * cache so the share dialog reflects the new state instantly.
 */
export function useSharePlaylist() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, isPublic }: { id: string; isPublic: boolean }) =>
      api.put<ShareResponse>(`/playlists/${id}/share`, { public: isPublic }),
    onSuccess: (data, vars) => {
      qc.setQueryData<Playlist | undefined>(['playlist', vars.id], (old) =>
        old ? { ...old, isPublic: data.isPublic, shareToken: data.shareToken } : old,
      );
      qc.invalidateQueries({ queryKey: ['playlists'] });
    },
  });
}

/**
 * Fetch a public playlist by its share token. JWT-required server
 * side. Used by the `/p/:token` route.
 */
export function useSharedPlaylist(token: string | undefined | null) {
  return useQuery({
    queryKey: ['shared-playlist', token],
    queryFn: () => api.get<SharedPlaylistResponse>(`/playlists/shared/${token}`),
    enabled: Boolean(token),
    // Re-fetch on window focus so an unpublish on the source
    // immediately propagates if the viewer's tab regains focus.
    staleTime: 30_000,
  });
}

/**
 * Save a public playlist (by share token) into the requester's
 * library as a linked-user reference. Idempotent server-side.
 */
export function useSavePlaylistFromShare() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (token: string) =>
      api.post<Playlist>(`/playlists/shared/${token}/save`, {}),
    onSuccess: (_data, token) => {
      qc.invalidateQueries({ queryKey: ['playlists'] });
      qc.invalidateQueries({ queryKey: ['shared-playlist', token] });
    },
  });
}

/**
 * Save a Tidal editorial playlist into the requester's library as a
 * linked-tidal reference. Idempotent — re-saving returns the
 * existing row.
 */
export function useSaveTidalPlaylist() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { tidalId: string; name: string; coverUrl?: string | null; curator?: string | null }) =>
      api.post<Playlist>('/playlists/external/tidal', input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['playlists'] });
    },
  });
}

/**
 * Build the public share URL for a given share token. Mirrors the
 * `/p/:token` route registered in `router.tsx`. Uses `window.origin`
 * (with the `BASE_URL` Vite injects so we match the deployed
 * GitHub Pages base path).
 */
export function buildShareUrl(token: string): string {
  const base = (import.meta.env.BASE_URL ?? '/').replace(/\/$/, '');
  // Use `window.location.origin` rather than the API URL so the link
  // always points at the user-facing app, not the worker.
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  return `${origin}${base}/p/${token}`;
}
