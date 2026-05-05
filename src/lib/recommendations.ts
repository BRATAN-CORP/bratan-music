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
  /** Set when the user has already promoted this daily playlist into
   *  their library; the home-page card uses this to render a persistent
   *  "Сохранено" state across reloads. */
  savedToPlaylistId?: string;
}

interface ItemsResponse<T> { items: T[]; }

/** Moods exposed to the user when starting My Wave. Mirror of
 *  WAVE_MOODS in worker/services/RecommendationService.ts. */
export const WAVE_MOODS = ['chill', 'workout', 'focus', 'party', 'throwback'] as const;
export type WaveMood = typeof WAVE_MOODS[number];

/** Endless personal stream. Used by the "Моя волна" button + home page.
 *  When `mood` is set we tag the request and the backend mixes that
 *  mood's explore page into the candidate pool with a fixed bonus. */
export async function fetchWave(limit = 25, mood: WaveMood | null = null): Promise<Track[]> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (mood) params.set('mood', mood);
  const data = await api.get<ItemsResponse<Track>>(`/recommendations/wave?${params.toString()}`);
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

export interface SeedArtistsState {
  artistIds: string[];
  hasHistory: boolean;
}

/** Cold-start (preferred): read currently-picked seed artist ids. */
export async function fetchSeedArtists(): Promise<SeedArtistsState> {
  return api.get(`/recommendations/seed-artists`);
}

/** Cold-start (preferred): write 1-12 picked artist ids. */
export async function setSeedArtists(artistIds: string[]): Promise<void> {
  await api.post(`/recommendations/seed-artists`, { artistIds });
}

export interface SeedArtistCandidate {
  id: string;
  name: string;
  imageUrl?: string;
}

interface SeedArtistsResponse { items: SeedArtistCandidate[]; }

/** Search Tidal artists for the cold-start picker. */
export async function searchSeedArtists(query: string): Promise<SeedArtistCandidate[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const data = await api.get<SeedArtistsResponse>(
    `/recommendations/artists/search?q=${encodeURIComponent(q)}`,
  );
  return data.items ?? [];
}

/** Suggested artists shown when the search input is empty. */
export async function fetchSuggestedSeedArtists(): Promise<SeedArtistCandidate[]> {
  const data = await api.get<SeedArtistsResponse>(`/recommendations/artists/suggested`);
  return data.items ?? [];
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
  /**
   * Full structured contributor list. Worker stores this alongside
   * the joined `artistName` so the recent-plays renderer can give
   * each name its own clickable link instead of wrapping the whole
   * "A, B, C" string in a single anchor.
   */
  artists?: { id: string; name: string }[];
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
