import type { Track } from '@/types';

/**
 * Pick just the fields the player store cares about. Centralised so we
 * don't drift between the seven+ call sites that hand a Track to the
 * player — most importantly, the multi-artist `artists` list now flows
 * through unchanged so the mini-player and fullscreen UI can render
 * each contributor as its own clickable link.
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
  };
}
