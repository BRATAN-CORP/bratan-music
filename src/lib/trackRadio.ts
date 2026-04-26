import { api } from '@/lib/api';
import { usePlayerStore } from '@/store/player';
import type { Track } from '@/types';

export interface RadioResponse {
  items: Track[];
}

/**
 * Fetches a Tidal "track radio" — a playlist of tracks similar to the seed —
 * and replaces the player queue with `[seed, ...radio]`. The seed becomes the
 * current track and starts playing immediately.
 *
 * The artist id on radio tracks is preserved so "go to artist" keeps working.
 */
export async function startTrackRadio(seed: Track): Promise<number> {
  const data = await api.get<RadioResponse>(`/tracks/${seed.id}/radio`);
  const radio = (data.items ?? []).filter((t) => t.id !== seed.id);

  const player = usePlayerStore.getState();
  player.setQueue([seed, ...radio]);
  player.setTrack(seed);
  return radio.length;
}
