import { TidalAuth } from './TidalAuth';
import type { Env } from '../../types/env';

const API_BASE = 'https://api.tidal.com/v1';

interface PlaybackInfo {
  trackId: number;
  audioMode: string;
  audioQuality: string;
  manifestMimeType: string;
  manifest: string;
}

interface BtsManifest {
  urls: string[];
  codecs: string;
  mimeType: string;
  encryptionType: string;
}

export interface ResolvedStream {
  url: string;
  quality: string;
  codec: string;
  mimeType: string;
}

const QUALITY_LADDER = ['HI_RES_LOSSLESS', 'HI_RES', 'LOSSLESS', 'HIGH', 'LOW'];

// Tidal returns DRM-encrypted manifests for high qualities (FLAC and
// up) and a plain CDN URL for HIGH/LOW. The actual cutoff between
// "encrypted" and "playable in a bare <audio>" depends on per-track
// licensing, so the only way to discover the highest-playable
// quality is empirical: try the requested quality, decode the
// manifest, fall through if it's encrypted, repeat.
//
// In practice the answer is stable per track (a given Tidal track
// always exposes the same set of qualities), so caching the highest
// unencrypted quality the ladder ever resolved to lets every
// subsequent resolve land in one HTTP round trip instead of up to
// five. The cache TTL is long because tracks are immutable, but
// finite so a Tidal-side licensing change eventually re-probes.
const QUALITY_CACHE_TTL_S = 60 * 60 * 24 * 30; // 30 days
const QUALITY_CACHE_PREFIX = 'tidal-track-quality:';

export class TidalWeb {
  private kv: KVNamespace | null;

  constructor(private auth: TidalAuth, env?: Env) {
    this.kv = env?.SESSIONS ?? null;
  }

  async getStreamUrl(trackId: string, quality: string = 'HIGH'): Promise<string> {
    const resolved = await this.resolveStream(trackId, quality);
    return resolved.url;
  }

  /**
   * Resolve the best playable stream for a track. We always cap at the
   * caller's requested quality but, if KV has previously memoised a
   * known-good quality for this track, we start the ladder from there
   * — turning the typical resolve into a single HTTP round trip.
   * On miss we walk the full ladder and write the answer back.
   */
  async resolveStream(trackId: string, requestedQuality: string = 'HIGH'): Promise<ResolvedStream> {
    const requestedIdx = QUALITY_LADDER.indexOf(requestedQuality.toUpperCase());
    const cap = requestedIdx >= 0 ? requestedIdx : QUALITY_LADDER.indexOf('HIGH');

    let startIdx = cap;
    const cached = await this.readCachedQuality(trackId);
    if (cached) {
      const cachedIdx = QUALITY_LADDER.indexOf(cached);
      // Only honour the cache if it's at-or-below the requested cap;
      // otherwise we'd silently downgrade the caller.
      if (cachedIdx >= cap) startIdx = cachedIdx;
    }

    const ladder = QUALITY_LADDER.slice(startIdx);
    let lastError = '';

    for (const quality of ladder) {
      try {
        const info = await this.getPlaybackInfo(trackId, quality);
        const manifest = this.decodeManifest(info.manifest, info.manifestMimeType);
        if (!manifest.urls.length) {
          lastError = `${quality}: empty urls`;
          continue;
        }
        if (manifest.encryptionType && manifest.encryptionType.toUpperCase() !== 'NONE') {
          lastError = `${quality}: encrypted`;
          continue;
        }
        // Memoise the working quality so the next call to this track
        // skips the upper rungs of the ladder.
        await this.writeCachedQuality(trackId, quality);
        return {
          url: manifest.urls[0],
          quality,
          codec: manifest.codecs,
          mimeType: manifest.mimeType,
        };
      } catch (err) {
        lastError = `${quality}: ${err instanceof Error ? err.message : String(err)}`;
      }
    }
    throw new Error(`Не удалось получить поток: ${lastError}`);
  }

  private async readCachedQuality(trackId: string): Promise<string | null> {
    if (!this.kv) return null;
    try {
      const raw = await this.kv.get(`${QUALITY_CACHE_PREFIX}${trackId}`);
      if (!raw) return null;
      const upper = raw.toUpperCase();
      return QUALITY_LADDER.includes(upper) ? upper : null;
    } catch {
      return null;
    }
  }

  private async writeCachedQuality(trackId: string, quality: string): Promise<void> {
    if (!this.kv) return;
    try {
      await this.kv.put(
        `${QUALITY_CACHE_PREFIX}${trackId}`,
        quality.toUpperCase(),
        { expirationTtl: QUALITY_CACHE_TTL_S },
      );
    } catch {
      /* ignore — cache is best-effort */
    }
  }

  async getPlaybackInfo(trackId: string, quality: string = 'HIGH'): Promise<PlaybackInfo> {
    const cc = await this.auth.getCountryCode();
    const params = new URLSearchParams({
      audioquality: quality,
      playbackmode: 'STREAM',
      assetpresentation: 'FULL',
      countryCode: cc,
    });

    const doFetch = async (token: string) => fetch(
      `${API_BASE}/tracks/${trackId}/playbackinfopostpaywall?${params}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
          'User-Agent': 'TIDAL/2026.4.23 CFNetwork/1494.0.7 Darwin/23.4.0',
          'x-tidal-client-version': this.auth.getClientVersion(),
        },
      }
    );

    let token = await this.auth.getAccessToken();
    let res = await doFetch(token);
    if (res.status === 401) {
      token = await this.auth.getAccessToken({ force: true });
      res = await doFetch(token);
    }

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`playbackinfo ${res.status}: ${text.slice(0, 200)}`);
    }

    return res.json<PlaybackInfo>();
  }

  async getDownloadUrl(trackId: string, quality: string = 'LOSSLESS'): Promise<string> {
    return this.getStreamUrl(trackId, quality);
  }

  private decodeManifest(manifestB64: string, mimeType: string): BtsManifest {
    const decoded = atob(manifestB64);

    if (mimeType === 'application/vnd.tidal.bts') {
      return JSON.parse(decoded) as BtsManifest;
    }

    if (mimeType === 'application/dash+xml') {
      const baseUrlMatch = decoded.match(/<BaseURL[^>]*>([^<]+)<\/BaseURL>/);
      if (baseUrlMatch) {
        return {
          urls: [baseUrlMatch[1].trim()],
          codecs: this.extractCodec(decoded),
          mimeType: 'audio/mp4',
          encryptionType: 'NONE',
        };
      }
      const initMatch = decoded.match(/initialization="([^"]+)"/);
      if (initMatch) {
        const initUrl = initMatch[1].replace(/\$RepresentationID\$/g, 'audio');
        return {
          urls: [initUrl],
          codecs: this.extractCodec(decoded),
          mimeType: 'audio/mp4',
          encryptionType: 'NONE',
        };
      }
    }

    throw new Error(`unsupported manifest mime: ${mimeType}`);
  }

  private extractCodec(dashXml: string): string {
    const m = dashXml.match(/codecs="([^"]+)"/);
    return m?.[1] ?? 'mp4a.40.2';
  }
}
