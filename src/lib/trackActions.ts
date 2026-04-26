import { api } from '@/lib/api';

export interface DownloadableTrack {
  id: string;
  title: string;
  artist: string;
}

function pickExtension(contentType: string | null | undefined): string {
  const ct = (contentType ?? '').toLowerCase();
  if (ct.includes('flac')) return 'flac';
  if (ct.includes('mp4') || ct.includes('m4a') || ct.includes('aac')) return 'm4a';
  if (ct.includes('mpeg') || ct.includes('mp3')) return 'mp3';
  return 'flac';
}

function safeFileName(track: DownloadableTrack): string {
  return `${track.artist} — ${track.title}`
    .replace(/[\\/:*?"<>|]/g, '_')
    .slice(0, 180);
}

/**
 * Download a track as a file (real "Save As", not a new tab).
 *
 * The `<a download>` attribute is ignored when the href is cross-origin,
 * which is the case for Tidal's CDN URLs returned by the worker. So we
 * fetch the audio as a Blob, create a same-origin object URL, and click
 * an anchor pointing at the blob — that always triggers a download.
 */
export async function downloadTrack(track: DownloadableTrack): Promise<void> {
  const data = await api.get<{ url: string }>(`/tracks/${track.id}/download`);
  const res = await fetch(data.url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const blob = await res.blob();
  const blobUrl = URL.createObjectURL(blob);
  const ext = pickExtension(res.headers.get('content-type') ?? blob.type);

  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = `${safeFileName(track)}.${ext}`;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  // Defer revocation so the browser can finalize the download.
  window.setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
}
