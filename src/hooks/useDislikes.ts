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

export const DISLIKES_QUERY_KEY = ['dislikes'] as const;

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
 * Side-effect: keep the synchronous Zustand mirror in sync with the
 * React Query cache. Mount once via `<DislikesBootstrap />`.
 */
export function useDislikesBootstrap() {
  const q = useDislikesQuery();
  const setAll = useDislikesStore((s) => s.setAll);
  useEffect(() => {
    if (q.data) setAll(q.data);
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
      // if the current track itself was the one banned. The player
      // store reads from the synchronous mirror we just updated.
      if (nextState === 'banned') {
        usePlayerStore.getState().pruneBanned();
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
      // Recommendation-driven feeds need to re-fetch so newly-banned
      // items disappear (or restored ones reappear) without a hard
      // reload.
      qc.invalidateQueries({ queryKey: ['recommendations'] });
      qc.invalidateQueries({ queryKey: ['daily-playlists'] });
    },
  });
}
