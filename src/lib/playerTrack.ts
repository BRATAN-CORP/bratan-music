import type { Track } from '@/types';

/**
 * Minimal subset the player store accepts via setTrack(). Pages and
 * lists pass richer Track objects; we narrow to the shape the store
 * stores so callers don't have to know which fields the persist
 * middleware keeps.
 */
export type PlayableTrack = Pick<
  Track,
  'id' | 'title' | 'artist' | 'duration'
> &
  Partial<Pick<Track, 'artistId' | 'artists' | 'albumId' | 'coverUrl' | 'coverVideoUrl' | 'explicit' | 'source'>>;

/**
 * Pick just the fields the player store cares about. Centralised so we
 * don't drift between the seven+ call sites that hand a Track to the
 * player — most importantly, the multi-artist `artists` list and the
 * source-provider Explicit flag flow through unchanged so the
 * mini-player / fullscreen / mobile dock can render every contributor
 * as its own clickable link AND show the `<ExplicitBadge>` on tracks
 * the source provider tagged as explicit. (`usePlaybackSync` used to
 * carry its own `toPlayable` copy of this mapper — they drifted once
 * already; keep this the ONLY place that narrows a track for the
 * player.)
 */
export function toPlayerTrack(t: PlayableTrack): PlayableTrack {
  return {
    id: t.id,
    title: t.title,
    artist: t.artist,
    artistId: t.artistId,
    artists: t.artists,
    albumId: t.albumId,
    coverUrl: t.coverUrl,
    coverVideoUrl: t.coverVideoUrl,
    duration: t.duration,
    explicit: t.explicit,
    // Carry the provider tag — used by usePlayHistoryLogger when
    // posting `/history/play` so the recent-plays strip groups
    // together rows from the same provider correctly.
    source: t.source,
  };
}
