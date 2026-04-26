import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import type { Track } from '@/types';

const API_BASE = import.meta.env.VITE_API_URL ?? 'https://bratan-music-api.bratan-corp.workers.dev';

export interface UploadTrack extends Track {
  rawId: string;
  source: 'upload';
  mimeType: string;
  sizeBytes: number;
  createdAt: number;
}

interface UploadListResponse {
  items: UploadTrack[];
}

export function useUploads() {
  return useQuery({
    queryKey: ['uploads'],
    queryFn: async () => {
      const r = await api.get<UploadListResponse>('/uploads');
      return r.items ?? [];
    },
  });
}

interface UploadInput {
  file: File;
  title?: string;
  artist?: string;
  album?: string;
  duration?: number;
  cover?: string | null;
  /** Optional progress callback (0..1). */
  onProgress?: (p: number) => void;
}

/**
 * Direct XHR upload to keep a progress callback. (fetch() doesn't expose
 * upload progress in any browser yet.) Returns the parsed UploadTrack.
 */
function xhrUpload(path: string, method: 'POST' | 'PUT', form: FormData, token: string, onProgress?: (p: number) => void): Promise<UploadTrack> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, `${API_BASE}${path}`);
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    if (onProgress) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress(e.loaded / e.total);
      };
    }
    xhr.onload = () => {
      try {
        const data = JSON.parse(xhr.responseText) as UploadTrack | { error: string };
        if (xhr.status >= 400 || (data as { error?: string }).error) {
          reject(new Error((data as { error?: string }).error ?? `HTTP ${xhr.status}`));
        } else {
          resolve(data as UploadTrack);
        }
      } catch {
        reject(new Error(`HTTP ${xhr.status}`));
      }
    };
    xhr.onerror = () => reject(new Error('Network error'));
    xhr.send(form);
  });
}

export function useCreateUpload() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: UploadInput) => {
      const token = useAuthStore.getState().accessToken ?? '';
      const form = new FormData();
      form.append('file', input.file);
      if (input.title) form.append('title', input.title);
      if (input.artist) form.append('artist', input.artist);
      if (input.album) form.append('album', input.album);
      if (input.duration) form.append('duration', String(Math.round(input.duration)));
      if (input.cover) form.append('cover', input.cover);
      return xhrUpload('/uploads', 'POST', form, token, input.onProgress);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['uploads'] }),
  });
}

interface UpdateInput {
  id: string;
  title?: string;
  artist?: string;
  album?: string;
  cover?: string | null;
}

export function useUpdateUpload() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...patch }: UpdateInput) => api.put<UploadTrack>(`/uploads/${id}`, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['uploads'] }),
  });
}

export function useReplaceUploadFile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, file, duration, onProgress }: { id: string; file: File; duration?: number; onProgress?: (p: number) => void }) => {
      const token = useAuthStore.getState().accessToken ?? '';
      const form = new FormData();
      form.append('file', file);
      if (duration) form.append('duration', String(Math.round(duration)));
      return xhrUpload(`/uploads/${id}/file`, 'PUT', form, token, onProgress);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['uploads'] }),
  });
}

export function useDeleteUpload() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/uploads/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['uploads'] }),
  });
}

/**
 * Best-effort extraction of duration from a local audio file. Plays nothing —
 * just decodes metadata via a hidden <audio> element.
 */
export function probeAudioDuration(file: File): Promise<number> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const audio = document.createElement('audio');
    audio.preload = 'metadata';
    audio.src = url;
    const cleanup = () => URL.revokeObjectURL(url);
    audio.onloadedmetadata = () => {
      const d = audio.duration;
      cleanup();
      resolve(isFinite(d) ? d : 0);
    };
    audio.onerror = () => { cleanup(); resolve(0); };
  });
}
