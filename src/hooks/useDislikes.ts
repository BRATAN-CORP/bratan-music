import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { useDislikesStore } from '@/store/dislikes';
import { usePlayerStore } from '@/store/player';

/**
 * Server-side state hook for the user's dislike list. Owns:
 *
 *   - `useDislikesQuery()`: fetch + cache via React Query.
 *   - `useDislikesBootstrap()`: side-effect that pipes the query data
 *     into the synchronous `useDislikesStore`. Mounted once at the
 *     app root by `<DislikesBootstrap />`.
 *   - `useToggleDislike()`: mutation for the kebab menu / artist page
 *     buttons. Optimistically updates the store so the UI flips
 *     instantly, then settles the server.
 *
 * Two stores instead of one because:
 *   - React Query is the canonical source for server state +
 *     suspense / refetch management.
 *   - The Zustand store is consumed by non-React callers (player
 *     store's `addToQueue`, `next`, audio engine retry path) where
 *     a synchronous Set lookup is needed.
 */

interface DislikesPayload {
  tracks: string[];
  artists: string[];
}

export interface BannedTrackDetail {
  id: string;
  title: string;
  artist: string;
  artistId: string | null;
  coverUrl: string | null;
  duration: number;
  addedAt: number | null;
  unavailable: boolean;
  /** Source-provider "Explicit" flag from Tidal. Optional — the banned
   *  list pre-dates the badge, and stub rows for unavailable tracks
   *  don't carry it. The UI only renders the badge when `true`. */
  explicit?: boolean;
}

export interface BannedArtistDetail {
  id: string;
  name: string;
  imageUrl: string | null;
  addedAt: number | null;
  unavailable: boolean;
}

interface DislikesDetailsPayload {
  tracks: BannedTrackDetail[];
  artists: BannedArtistDetail[];
}

export const DISLIKES_QUERY_KEY = ['dislikes'] as const;
export const DISLIKES_DETAILS_QUERY_KEY = ['dislikes', 'details'] as const;

export function useDislikesQuery() {
  const isAuthed = useAuthStore((s) => Boolean(s.user));
  return useQuery<DislikesPayload>({
    queryKey: DISLIKES_QUERY_KEY,
    queryFn: () => api.get<DislikesPayload>('/recommendations/dislikes'),
    enabled: isAuthed,
    // Banned-list rarely changes per session; stale-time keeps us
    // from re-fetching on every navigation. The mutation does its
    // own optimistic update + cache invalidation.
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Hydrated detail list for the profile "Скрытые" panel. Returns
 * full track / artist metadata so the panel can render meaningful
 * rows (cover, title, name) without N+1 client fetches. Heavier
 * than `useDislikesQuery` — only mount on screens that actually
 * render the list.
 */
export function useDislikesDetails() {
  const isAuthed = useAuthStore((s) => Boolean(s.user));
  return useQuery<DislikesDetailsPayload>({
    queryKey: DISLIKES_DETAILS_QUERY_KEY,
    queryFn: () => api.get<DislikesDetailsPayload>('/recommendations/dislikes/details'),
    enabled: isAuthed,
    // Stale-while-revalidate: details change when the user toggles a
    // dislike from the kebab. The mutation invalidates this query
    // explicitly, so the staleTime here just keeps idle navigation
    // from re-fetching the (potentially expensive) hydrated list.
    staleTime: 60 * 1000,
  });
}

/**
 * Side-effect: keep the synchronous Zustand mirror in sync with the
 * React Query cache. Mount once via `<DislikesBootstrap />`.
 */
export function useDislikesBootstrap() {
  const q = useDislikesQuery();
  const setAll = useDislikesStore((s) => s.setAll);
  useEffect(() => {
    if (!q.data) return;
    setAll(q.data);
    // The persisted player queue may pre-date the user's most recent
    // bans (they could have been added on another device, or before
    // a sync resolved). Prune any banned items now so they don't
    // leak into Previous/Next walks or the queue dialog.
    usePlayerStore.getState().pruneBanned();
  }, [q.data, setAll]);
}

/**
 * Mutation: toggle ban-state for a track or artist.
 *
 *   - `nextState='banned'`: POSTs `/recommendations/dislikes`.
 *   - `nextState='unbanned'`: DELETEs `/recommendations/dislikes/...`.
 *
 * Optimistically updates both the React Query cache and the Zustand
 * mirror so the kebab menu's "ban / restore" copy flips on click. On
 * error we roll the optimistic update back.
 */
interface ToggleArgs {
  kind: 'track' | 'artist';
  id: string;
  /** Source tag — 'tidal' is the only catalog we have today. Future
   *  uploads / overrides would pass their own source so the worker
   *  filter logic can branch correctly. */
  source?: string;
  nextState: 'banned' | 'unbanned';
}

export function useToggleDislike() {
  const qc = useQueryClient();
  const addLocal = useDislikesStore((s) => s.addLocal);
  const removeLocal = useDislikesStore((s) => s.removeLocal);

  return useMutation({
    mutationFn: async ({ kind, id, source, nextState }: ToggleArgs) => {
      if (nextState === 'banned') {
        await api.post('/recommendations/dislikes', {
          itemId: id,
          kind,
          source: source ?? 'tidal',
        });
      } else {
        await api.delete(`/recommendations/dislikes/${kind}/${encodeURIComponent(id)}`);
      }
    },
    onMutate: async ({ kind, id, nextState }) => {
      await qc.cancelQueries({ queryKey: DISLIKES_QUERY_KEY });
      const prev = qc.getQueryData<DislikesPayload>(DISLIKES_QUERY_KEY);
      qc.setQueryData<DislikesPayload>(DISLIKES_QUERY_KEY, (old) => {
        const base: DislikesPayload = old ?? { tracks: [], artists: [] };
        const list = kind === 'track' ? base.tracks : base.artists;
        const next = nextState === 'banned'
          ? (list.includes(id) ? list : [id, ...list])
          : list.filter((x) => x !== id);
        return kind === 'track'
          ? { ...base, tracks: next }
          : { ...base, artists: next };
      });
      // Mirror to the synchronous Zustand store so the audio engine
      // and queue mutators see the new state right away.
      if (nextState === 'banned') addLocal(kind, id);
      else removeLocal(kind, id);
      // Drop any queue items the user just banned and skip-forward
      // ONLY if the user explicitly banned the currently-playing
      // track. Banning any other track (or any artist) leaves
      // audio untouched and only shrinks the queue. We always pass
      // the just-toggled id (track id for track bans, artist id for
      // artist bans — different namespace, will never match
      // currentTrack.id) so the player store can be exact rather
      // than falling back to a broad `isTrackBanned(currentTrack)`
      // heuristic that could mis-fire on legacy bans. The player
      // store reads from the synchronous mirror we just updated.
      if (nextState === 'banned') {
        usePlayerStore.getState().pruneBanned(id);
      }
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) {
        qc.setQueryData(DISLIKES_QUERY_KEY, ctx.prev);
        // Resync the synchronous mirror so it reflects the rollback.
        useDislikesStore.getState().setAll(ctx.prev);
      }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: DISLIKES_QUERY_KEY });
      // The hydrated profile-panel list needs to refresh too — the
      // user may have just unbanned a track from there and expects
      // the row to disappear.
      qc.invalidateQueries({ queryKey: DISLIKES_DETAILS_QUERY_KEY });
      // Recommendation-driven feeds need to re-fetch so newly-banned
      // items disappear (or restored ones reappear) without a hard
      // reload.
      qc.invalidateQueries({ queryKey: ['recommendations'] });
      qc.invalidateQueries({ queryKey: ['daily-playlists'] });
    },
  });
}
