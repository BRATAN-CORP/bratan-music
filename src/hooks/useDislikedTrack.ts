import { useDislikesStore } from '@/store/dislikes';

/**
 * Reactive selector for "is this track explicitly disliked".
 * Returns `true` only when the track id itself is on the user's
 * dislike list — artist-level bans deliberately don't propagate
 * here.
 *
 * Why split it from the recommendation-side filter:
 *   - Recommendations (wave / daily / AI / continue) MUST exclude
 *     anything by a banned artist; that filter is owned server-side
 *     in `dislikes.filterTracksByDislikes` and on the client by
 *     `isBanned()` from `store/dislikes`.
 *   - The track row UI (`TrackItem`, `PlaylistTrackItem`,
 *     `QueueDialog`) uses this hook to dim a row visually. The
 *     product call is: don't mark a row as "hidden" just because the
 *     user banned ONE of its credited artists — that would dim half
 *     of an album page after a single artist ban and visually
 *     conflate two different states (hidden track vs. hidden
 *     artist). The dim treatment is reserved for explicit per-track
 *     dislikes; artist bans only suppress recommendations.
 */
export interface BannableTrack {
  id: string;
}

export function useIsTrackBanned(track: BannableTrack | null | undefined): boolean {
  return useDislikesStore((s) => (track ? s.tracks.has(track.id) : false));
}
