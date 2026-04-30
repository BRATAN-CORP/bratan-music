import { useMutation } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import type { Track } from '@/types';

export interface AiPlanQuery { query: string; limit: number }
export interface AiPlan { name: string; description: string; queries: AiPlanQuery[] }

export interface AiPlaylistPreview {
  name: string;
  description: string;
  tracks: Track[];
  rejected: number;
  prompt: string;
  plan: AiPlan;
}

export interface SavedAiPlaylist {
  id: string;
  name: string;
  description: string;
  trackCount: number;
}

/**
 * One generate call already does a lot of upstream work (LLM plan +
 * fan-out searches + reranker). 502 / 503 / 504 / 408 from any of
 * those layers — or a brief network blip on the user's connection —
 * surfaces to the user as "Не удалось сгенерировать" even though the
 * second click usually goes through. Retry the request transparently
 * a couple of times before we ever surface a failure.
 */
const MAX_RETRIES = 2;
const BACKOFF_BASE_MS = 600;

function isTransient(err: unknown): boolean {
  if (err instanceof ApiError) {
    // 408 Request Timeout, 429 Too Many Requests, 5xx server errors.
    // 4xx other than 408/429 are caller's fault; don't waste a retry.
    return err.status === 408 || err.status === 429 || err.status >= 500;
  }
  // TypeError on `fetch` (network down, DNS, abort race) is treated
  // as transient too.
  return err instanceof TypeError;
}

async function generateWithRetry(prompt: string, size?: number): Promise<AiPlaylistPreview> {
  let lastErr: unknown = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await api.post<AiPlaylistPreview>('/ai/playlists/generate', { prompt, size });
    } catch (err) {
      lastErr = err;
      if (attempt >= MAX_RETRIES || !isTransient(err)) break;
      // Exponential backoff with a tiny jitter so two clients
      // hammering the same upstream don't sync up on retries.
      const delay = BACKOFF_BASE_MS * (attempt + 1) + Math.floor(Math.random() * 200);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

export function useGenerateAiPlaylist() {
  return useMutation<AiPlaylistPreview, Error, { prompt: string; size?: number }>({
    mutationFn: ({ prompt, size }) => generateWithRetry(prompt, size),
  });
}

export function useSaveAiPlaylist() {
  return useMutation<SavedAiPlaylist, Error, { name: string; description: string; tracks: Track[]; prompt: string }>({
    mutationFn: (body) => api.post<SavedAiPlaylist>('/ai/playlists/save', body),
  });
}
