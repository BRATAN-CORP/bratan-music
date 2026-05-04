import { create } from 'zustand';

/**
 * Synchronous slice over the user's banned-tracks / banned-artists
 * lists. Lives outside React so the audio engine, the player store's
 * queue mutators (`addToQueue`, `setQueue`, `next`), and any other
 * non-hook callsite can read the current state without going through
 * React Query.
 *
 * The source of truth is the server (`GET /recommendations/dislikes`);
 * `<DislikesBootstrap />` keeps this slice in sync by piping the
 * fetched data into `setAll()`. Mutations (`useToggleDislike`)
 * optimistically update via `addLocal` / `removeLocal` so UI affordances
 * react instantly without waiting for the round-trip.
 *
 * Sets vs. arrays: `Set<string>` for O(1) lookups in the hot
 * `next-track` skip path. Arrays are derived in helpers when needed.
 */
interface DislikesState {
  /** True after `setAll()` has run at least once — components can
   *  use this to defer "should I show the banned indicator?" rendering
   *  until the bootstrap has resolved (otherwise the menu briefly
   *  shows "ban" then flips to "unban" right after first paint). */
  initialised: boolean;
  tracks: Set<string>;
  artists: Set<string>;

  setAll: (input: { tracks: string[]; artists: string[] }) => void;
  addLocal: (kind: 'track' | 'artist', id: string) => void;
  removeLocal: (kind: 'track' | 'artist', id: string) => void;

  isTrackDisliked: (id: string) => boolean;
  isArtistDisliked: (id: string) => boolean;
}

export const useDislikesStore = create<DislikesState>((set, get) => ({
  initialised: false,
  tracks: new Set<string>(),
  artists: new Set<string>(),

  setAll: ({ tracks, artists }) =>
    set({
      initialised: true,
      tracks: new Set(tracks),
      artists: new Set(artists),
    }),

  addLocal: (kind, id) =>
    set((s) => {
      if (kind === 'track') {
        if (s.tracks.has(id)) return s;
        const next = new Set(s.tracks);
        next.add(id);
        return { tracks: next };
      }
      if (s.artists.has(id)) return s;
      const next = new Set(s.artists);
      next.add(id);
      return { artists: next };
    }),

  removeLocal: (kind, id) =>
    set((s) => {
      if (kind === 'track') {
        if (!s.tracks.has(id)) return s;
        const next = new Set(s.tracks);
        next.delete(id);
        return { tracks: next };
      }
      if (!s.artists.has(id)) return s;
      const next = new Set(s.artists);
      next.delete(id);
      return { artists: next };
    }),

  isTrackDisliked: (id) => get().tracks.has(id),
  isArtistDisliked: (id) => get().artists.has(id),
}));

/**
 * Pure helpers that mirror the server-side filter (worker
 * `services/dislikes.ts → filterTracksByDislikes`).
 *
 * Reads the current snapshot of the dislikes store, so safe to call
 * from non-React code (player store mutators, audio engine).
 *
 * Two predicates because the user's mental model splits them:
 *
 *   - `isBanned()` — track-id banned OR any credited artist banned.
 *     Used everywhere a track is "filterable" — recommendation
 *     fetchers, AI mixes, daily playlists, the wave, infinite radio
 *     fill, the visual dim treatment in track lists. This is the
 *     "should we show / suggest this track?" lens.
 *
 *   - `isTrackBanned()` — only checks the track-id. Used by the
 *     player's queue walking (`next()` / `previous()`) and
 *     `pruneBanned()`. The user's queue is a deliberate, manual
 *     selection: tracks added by the user (or kept from a previous
 *     session's queue) should keep playing even if a credited artist
 *     was later banned. Banning an artist hides the artist from
 *     recommendations going forward but does not retroactively yank
 *     their tracks out of the user's already-curated queue.
 */
export interface FilterableTrack {
  id: string;
  artistId?: string;
  artists?: { id: string }[];
}

export function isBanned(track: FilterableTrack | null | undefined): boolean {
  if (!track) return false;
  const { tracks, artists } = useDislikesStore.getState();
  if (tracks.has(track.id)) return true;
  if (track.artistId && artists.has(track.artistId)) return true;
  if (Array.isArray(track.artists)) {
    for (const a of track.artists) {
      if (a.id && artists.has(a.id)) return true;
    }
  }
  return false;
}

/**
 * Track-id-only check. Artist bans are *not* considered. See block
 * comment above for the reasoning behind the split.
 */
export function isTrackBanned(track: FilterableTrack | null | undefined): boolean {
  if (!track) return false;
  return useDislikesStore.getState().tracks.has(track.id);
}

/**
 * Recommendation-side filter — drops items whose track id or any
 * credited artist id sits on the banned list. Used by the
 * recommendation fetchers and `pruneBanned()` for explicit track
 * bans (which still get pruned).
 */
export function filterBanned<T extends FilterableTrack>(items: T[]): T[] {
  const { tracks, artists } = useDislikesStore.getState();
  if (tracks.size === 0 && artists.size === 0) return items;
  return items.filter((t) => {
    if (tracks.has(t.id)) return false;
    if (t.artistId && artists.has(t.artistId)) return false;
    if (Array.isArray(t.artists)) {
      for (const a of t.artists) {
        if (a.id && artists.has(a.id)) return false;
      }
    }
    return true;
  });
}

/**
 * Queue-side filter — only drops items whose track id is banned.
 * Mirrors `isTrackBanned()` so banning an artist never silently
 * yanks their tracks out of the user's already-curated queue.
 */
export function filterTrackBanned<T extends FilterableTrack>(items: T[]): T[] {
  const { tracks } = useDislikesStore.getState();
  if (tracks.size === 0) return items;
  return items.filter((t) => !tracks.has(t.id));
}
