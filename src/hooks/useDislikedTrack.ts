import { useDislikesStore } from '@/store/dislikes';

/**
 * Reactive variant of `isBanned()` from `store/dislikes` for React
 * components. Subscribes to both the track-id and artist-id sets so
 * row-level UI re-renders the moment the user (un)bans something
 * from a kebab elsewhere in the app, without each consumer wiring
 * its own selector.
 *
 * Mirrors the server-side filter: a track is "banned" if its own
 * id is on the dislike list, OR its primary artistId is, OR any
 * credited contributor in `artists[]` is.
 */
export interface BannableTrack {
  id: string;
  artistId?: string;
  artists?: { id: string }[];
}

export function useIsTrackBanned(track: BannableTrack | null | undefined): boolean {
  const trackBanned = useDislikesStore((s) =>
    track ? s.tracks.has(track.id) : false,
  );
  const artistBanned = useDislikesStore((s) => {
    if (!track) return false;
    if (track.artistId && s.artists.has(track.artistId)) return true;
    if (Array.isArray(track.artists)) {
      for (const a of track.artists) {
        if (a.id && s.artists.has(a.id)) return true;
      }
    }
    return false;
  });
  return trackBanned || artistBanned;
}
