import { api } from '@/lib/api';
import type { Track } from '@/types';

export interface DailyPlaylist {
  id: string;
  variant: 'familiar' | 'discover' | 'mood';
  name: string;
  description: string;
  coverUrl?: string;
  tracks: Track[];
  generatedAt: number;
}

interface ItemsResponse<T> { items: T[]; }

/** Endless personal stream. Used by the "Моя волна" button + home page. */
export async function fetchWave(limit = 25): Promise<Track[]> {
  const data = await api.get<ItemsResponse<Track>>(`/recommendations/wave?limit=${limit}`);
  return data.items ?? [];
}

/** Extend playback context — fired when the queue is about to run dry. */
export async function fetchContinue(seedTrackId: string, limit = 20): Promise<Track[]> {
  const data = await api.post<ItemsResponse<Track>>(`/recommendations/continue`, { seedTrackId, limit });
  return data.items ?? [];
}

/** Three daily playlists: knowing, discovery, mood. */
export async function fetchDailyPlaylists(): Promise<DailyPlaylist[]> {
  const data = await api.get<ItemsResponse<DailyPlaylist>>(`/daily-playlists/today`);
  return data.items ?? [];
}

/** Promote a daily playlist into the user's library. Returns the new playlist id. */
export async function saveDailyPlaylist(id: string): Promise<{ id: string; name: string }> {
  return api.post(`/daily-playlists/save/${id}`);
}

/** Cold-start: read currently-saved genre seeds (and whether the user has any history). */
export async function fetchGenreSeeds(): Promise<{ slugs: string[]; hasHistory: boolean }> {
  return api.get(`/recommendations/genre-seeds`);
}

/** Cold-start: write 3-8 picked genre slugs. */
export async function setGenreSeeds(slugs: string[]): Promise<void> {
  await api.post(`/recommendations/genre-seeds`, { slugs });
}

export async function dislikeItem(
  itemId: string,
  kind: 'track' | 'artist',
  source: string = 'tidal',
): Promise<void> {
  await api.post(`/recommendations/dislikes`, { itemId, kind, source });
}

export async function undislikeItem(itemId: string, kind: 'track' | 'artist'): Promise<void> {
  await api.delete(`/recommendations/dislikes/${kind}/${encodeURIComponent(itemId)}`);
}

export interface RecentTrack extends Track {
  playedAt: number;
}

export async function fetchRecentPlays(limit = 20): Promise<RecentTrack[]> {
  const data = await api.get<ItemsResponse<RecentTrack>>(`/history/recent?limit=${limit}`);
  return data.items ?? [];
}

export interface PlayLogPayload {
  trackId: string;
  source?: string;
  artistId?: string;
  artistName?: string;
  title?: string;
  albumId?: string;
  coverUrl?: string;
  duration?: number;
  listenedSeconds?: number;
  completed?: boolean;
}

export async function logPlay(payload: PlayLogPayload): Promise<void> {
  // Best-effort: don't surface failures, the history beacon is decorative.
  try {
    await api.post(`/history/play`, payload);
  } catch {
    // swallow
  }
}
