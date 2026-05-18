import type { Track } from '@/types';

/**
 * Pick just the fields the player store cares about. Centralised so we
 * don't drift between the seven+ call sites that hand a Track to the
 * player — most importantly, the multi-artist `artists` list and the
 * source-provider Explicit flag flow through unchanged so the
 * mini-player / fullscreen / mobile dock can render every contributor
 * as its own clickable link AND show the `<ExplicitBadge>` on tracks
 * the source provider tagged as explicit.
 */
export function toPlayerTrack(t: Track) {
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
