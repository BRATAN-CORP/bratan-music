import { useMutation } from '@tanstack/react-query';
import { api } from '@/lib/api';
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

export function useGenerateAiPlaylist() {
  return useMutation<AiPlaylistPreview, Error, { prompt: string; size?: number }>({
    mutationFn: ({ prompt, size }) =>
      api.post<AiPlaylistPreview>('/ai/playlists/generate', { prompt, size }),
  });
}

export function useSaveAiPlaylist() {
  return useMutation<SavedAiPlaylist, Error, { name: string; description: string; tracks: Track[]; prompt: string }>({
    mutationFn: (body) => api.post<SavedAiPlaylist>('/ai/playlists/save', body),
  });
}
