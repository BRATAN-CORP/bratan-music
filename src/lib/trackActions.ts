import { useAuthStore } from '@/store/auth';

const API_BASE = import.meta.env.VITE_API_URL ?? 'https://bratan-music-api.bratan-corp.workers.dev';

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
 * Download a track as a file. Goes through the worker `/tracks/:id/file`
 * proxy: the worker fetches the (cross-origin) Tidal CDN URL server-side
 * and streams the response back with a `Content-Disposition: attachment`
 * header — so we get a real "Save As" dialog regardless of CDN CORS.
 */
export async function downloadTrack(track: DownloadableTrack): Promise<void> {
  const token = useAuthStore.getState().accessToken;
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}/tracks/${track.id}/file`, { headers });
  if (!res.ok) {
    let message: string;
    try {
      const body = (await res.json()) as { error?: string };
      message = body.error ?? `HTTP ${res.status}`;
    } catch {
      message = `HTTP ${res.status}`;
    }
    throw new Error(message);
  }

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

/**
 * Build a public share URL for a track. Strips any in-app sub-route that
 * happens to be open at the time (so sharing while you're inside
 * `/playlist/:id` doesn't leak the playlist) and points at a clean
 * `/track/:id`.
 *
 * No `?autoplay=1` query — Мирослав asked for clean shareable URLs. The
 * `/track/:id?autoplay=1` form is still honoured by `TrackPage` for old
 * links that are already in the wild, but we no longer mint new ones.
 */
export function buildTrackShareUrl(trackId: string): string {
  const url = new URL(window.location.href);
  const base = `${url.origin}${url.pathname.replace(
    /\/?(track|search|playlist|album|artist|profile|admin|library|shared|explore)\/.*$/,
    '',
  )}`.replace(/\/$/, '');
  return `${base}/track/${trackId}`;
}

/** Copy any URL to the user's clipboard with a textarea fallback for
 *  insecure-context / locked-down browsers. Returns true on success. */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    try {
      const ok = document.execCommand('copy');
      return ok;
    } catch {
      return false;
    } finally {
      document.body.removeChild(textarea);
    }
  }
}
