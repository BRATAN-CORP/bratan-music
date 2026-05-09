import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { getSavedTrack } from '@/lib/offline';
import { putTrack } from '@/lib/offline/db';

export interface LyricsResponse {
  available: boolean;
  provider?: string | null;
  isRightToLeft?: boolean;
  lyrics?: string | null;
  subtitles?: string | null;
  error?: string;
}

/**
 * Lyrics for `trackId`, with offline fallback.
 *
 * Behaviour:
 *   1. If the track is saved offline AND has a `lyrics` row attached,
 *      we resolve from IndexedDB synchronously without hitting the
 *      network. This is what makes the panel work in the installed
 *      PWA on a plane / metro / etc.
 *   2. Otherwise we hit `/tracks/:id/lyrics` over the network. On a
 *      network failure we re-check IDB one more time as a defensive
 *      fallback (covers the "online but Tidal lyrics endpoint is
 *      flaky" case where we still have a perfectly good cached
 *      lyrics row from an earlier successful download).
 *   3. If the network call succeeds AND the track is saved offline
 *      AND the existing offline row has no lyrics yet, we patch the
 *      offline row in the background so the next offline view is
 *      already populated. We do NOT overwrite a non-empty offline
 *      lyrics row with a now-empty network response — the upstream
 *      provider can flip from "available" → "unavailable" between
 *      requests and we'd rather show stale lyrics than blank them
 *      out for an offline user.
 */
export function useLyrics(trackId: string | undefined | null) {
  return useQuery({
    queryKey: ['lyrics', trackId],
    queryFn: async (): Promise<LyricsResponse> => {
      if (!trackId) {
        return { available: false };
      }

      // Step 1 — try offline first. If we have a populated lyrics
      // row stored from the download, use it directly. We treat
      // `available: false` cached rows as "negative cache" too so
      // an offline user sees the proper "Текст не найден" copy
      // instead of a permanent loading spinner.
      const offlineHit = await readOfflineLyrics(trackId);
      if (offlineHit) return offlineHit;

      // Step 2 — network. On any error, re-check IDB one more
      // time (a track might have just been saved or the row was
      // populated by a previous successful network call we've
      // since dropped from this query's cache).
      try {
        const fresh = await api.get<LyricsResponse>(`/tracks/${trackId}/lyrics`);
        // Step 3 — patch the offline row in the background if the
        // track is saved but its `lyrics` field was missing (e.g.
        // the user downloaded the track before this feature shipped,
        // or the lyrics fetch failed at download time). Fire and
        // forget — the user-visible response is the network result
        // either way, so we don't await.
        if (fresh && fresh.available) {
          void backfillOfflineLyrics(trackId, fresh);
        }
        return fresh;
      } catch (err) {
        const fallback = await readOfflineLyrics(trackId);
        if (fallback) return fallback;
        throw err;
      }
    },
    enabled: Boolean(trackId),
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    retry: false,
  });
}

/** Read the offline-track row's `lyrics` payload and reshape it
 *  into the network response shape so callers don't have to branch
 *  on origin. Returns null when the track isn't saved or when its
 *  row predates this feature (no `lyrics` field). */
async function readOfflineLyrics(
  trackId: string,
): Promise<LyricsResponse | null> {
  try {
    const row = await getSavedTrack(trackId);
    if (!row?.lyrics) return null;
    return {
      available: row.lyrics.available,
      provider: row.lyrics.provider ?? null,
      isRightToLeft: row.lyrics.isRightToLeft,
      lyrics: row.lyrics.lyrics ?? null,
      subtitles: row.lyrics.subtitles ?? null,
    };
  } catch {
    return null;
  }
}

/** Patch a saved offline track's `lyrics` field in the background
 *  when we just fetched a fresh non-empty response and the row
 *  didn't have lyrics. Idempotent and never throws — purely a
 *  best-effort enhancement of older downloads. */
async function backfillOfflineLyrics(
  trackId: string,
  fresh: LyricsResponse,
): Promise<void> {
  try {
    const row = await getSavedTrack(trackId);
    if (!row) return;
    if (row.lyrics?.lyrics || row.lyrics?.subtitles) return;
    await putTrack({
      ...row,
      lyrics: {
        available: Boolean(fresh.available),
        provider: fresh.provider ?? null,
        isRightToLeft: Boolean(fresh.isRightToLeft),
        lyrics: fresh.lyrics ?? null,
        subtitles: fresh.subtitles ?? null,
        fetchedAt: Date.now(),
      },
    });
  } catch {
    /* non-fatal — caller already has the network response */
  }
}

export interface LyricLine {
  time: number; // seconds
  text: string;
}

/**
 * Parses LRC ("[mm:ss.xx] text") into time-stamped lines, sorted by time.
 * Tolerant to multiple timestamps per line, decimals, and stray header tags
 * like [ar:Artist] (those are skipped).
 */
export function parseLrc(src: string): LyricLine[] {
  const out: LyricLine[] = [];
  const lines = src.split(/\r?\n/);
  const tagRe = /\[(\d{1,2}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
  for (const line of lines) {
    const text = line.replace(tagRe, '').trim();
    let match: RegExpExecArray | null;
    tagRe.lastIndex = 0;
    while ((match = tagRe.exec(line)) !== null) {
      const min = Number(match[1]);
      const sec = Number(match[2]);
      const fracRaw = match[3] ?? '0';
      const frac = Number(fracRaw.padEnd(3, '0').slice(0, 3)) / 1000;
      const time = min * 60 + sec + frac;
      if (Number.isFinite(time)) out.push({ time, text });
    }
  }
  out.sort((a, b) => a.time - b.time);
  return out;
}
