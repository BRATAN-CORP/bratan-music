import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export interface LyricsResponse {
  available: boolean;
  provider?: string | null;
  isRightToLeft?: boolean;
  lyrics?: string | null;
  subtitles?: string | null;
  error?: string;
}

export function useLyrics(trackId: string | undefined | null) {
  return useQuery({
    queryKey: ['lyrics', trackId],
    queryFn: () => api.get<LyricsResponse>(`/tracks/${trackId}/lyrics`),
    enabled: Boolean(trackId),
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    retry: false,
  });
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
