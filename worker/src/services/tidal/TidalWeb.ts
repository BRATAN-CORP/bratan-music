import { TidalAuth } from './TidalAuth';
import type { Env } from '../../types/env';

const API_BASE = 'https://api.tidal.com/v1';
// openapi.tidal.com exposes the entire quality matrix for a track in
// one shot via `/v2/trackManifests/:id` — see
// `docs/QUALITY_DISCOVERY_SPEC.md` for the full background.
const OPENAPI_BASE = 'https://openapi.tidal.com/v2';

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

// openapi.tidal.com format names → our `QUALITY_LADDER` values.
// `HI_RES` (MQA) is intentionally absent — `trackManifests` doesn't
// surface MQA as its own format. If a caller requests `HI_RES`, the
// resolver caps at index 1 and we pick the highest available rung
// at-or-below from this map (LOSSLESS / HIGH / LOW).
const FORMAT_TO_QUALITY: Record<string, string> = {
  FLAC_HIRES: 'HI_RES_LOSSLESS',
  FLAC: 'LOSSLESS',
  AACLC: 'HIGH',
  HEAACV1: 'LOW',
};

interface TrackManifestResponse {
  data?: {
    attributes?: {
      formats?: string[];
      drmData?: unknown;
    };
  };
}

interface DiscoveredQualities {
  /** Subset of `QUALITY_LADDER`, sorted high→low (low ladder index first). */
  qualities: string[];
}

// Tidal returns DRM-encrypted manifests for high qualities (FLAC and
// up) and a plain CDN URL for HIGH/LOW. The actual cutoff between
// "encrypted" and "playable in a bare <audio>" depends on per-track
// licensing, so the legacy resolver discovered the highest-playable
// quality by *probing*: try the requested quality, decode the manifest,
// fall through if it's encrypted, repeat. That ladder cost up to 4
// `playbackinfopostpaywall` round-trips on a cold cache.
//
// `discoverQualities` collapses the probe into one call to
// `openapi.tidal.com/v2/trackManifests/:id` whose `attributes.formats`
// lists every format the track has. We map those to our ladder names
// (`FLAC_HIRES`→`HI_RES_LOSSLESS` etc.), pick the highest at-or-below
// the caller's cap, and run a single `playbackinfopostpaywall`. The
// legacy ladder remains as `legacyResolveStream` and is invoked as a
// cold-fallback whenever discovery returns nothing or the picked
// quality lies (e.g. `formats[]` says FLAC but `playbackinfopostpaywall`
// answers `encrypted` for that track) — so this change is a strict
// superset of the old behaviour.
const QUALITY_CACHE_TTL_S = 60 * 60 * 24 * 30; // 30 days
const QUALITY_CACHE_PREFIX = 'tidal-track-quality:';
const DISCOVERY_CACHE_TTL_S = 60 * 60 * 24 * 30; // 30 days
const DISCOVERY_CACHE_PREFIX = 'tidal-track-formats:';

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
   * Resolve the best playable stream for a track.
   *
   * Discovers the track's available qualities in a single round trip
   * to `openapi.tidal.com/v2/trackManifests/:id` (KV-cached for 30 days
   * under `tidal-track-formats:<id>`), picks the highest quality
   * at-or-below the caller's requested cap, and runs a single-shot
   * `playbackinfopostpaywall` for that quality.
   *
   * If discovery yields nothing (5xx, unknown shape, DRM-only track)
   * or the chosen quality unexpectedly resolves to an encrypted /
   * empty manifest, falls back to {@link legacyResolveStream} which
   * walks the full ladder exactly like the pre-discovery code did.
   * Every short-circuit is a strict regression guard — discovery is
   * an optimisation, never a behaviour change for the caller.
   */
  async resolveStream(trackId: string, requestedQuality: string = 'HIGH'): Promise<ResolvedStream> {
    const requestedIdx = QUALITY_LADDER.indexOf(requestedQuality.toUpperCase());
    const cap = requestedIdx >= 0 ? requestedIdx : QUALITY_LADDER.indexOf('HIGH');

    const { qualities } = await this.discoverQualities(trackId);

    // `qualities` is sorted high→low (low ladder index first). Walk it
    // and pick the first rung whose ladder index is at-or-below `cap`
    // (remember: lower index == higher quality, so `idx >= cap` means
    // "this rung is at-or-below the requested cap").
    let target: string | null = null;
    for (const q of qualities) {
      const idx = QUALITY_LADDER.indexOf(q);
      if (idx >= cap) {
        target = q;
        break;
      }
    }

    if (!target) {
      return this.legacyResolveStream(trackId, requestedQuality);
    }

    let info: PlaybackInfo;
    try {
      info = await this.getPlaybackInfo(trackId, target);
    } catch {
      return this.legacyResolveStream(trackId, requestedQuality);
    }

    let manifest: BtsManifest;
    try {
      manifest = this.decodeManifest(info.manifest, info.manifestMimeType);
    } catch {
      return this.legacyResolveStream(trackId, requestedQuality);
    }

    if (!manifest.urls.length) {
      return this.legacyResolveStream(trackId, requestedQuality);
    }
    if (manifest.encryptionType && manifest.encryptionType.toUpperCase() !== 'NONE') {
      return this.legacyResolveStream(trackId, requestedQuality);
    }

    // Memoise the resolved quality in the existing
    // `tidal-track-quality:` KV namespace too, so if discovery ever
    // fails for this track in the future the legacy ladder fallback
    // also lands in one round trip.
    await this.writeCachedQuality(trackId, target);

    return {
      url: manifest.urls[0],
      quality: target,
      codec: manifest.codecs,
      mimeType: manifest.mimeType,
    };
  }

  /**
   * Legacy ladder-walking resolver. Calls `playbackinfopostpaywall`
   * starting at the requested cap (or a previously-memoised
   * lower rung from the `tidal-track-quality:` cache) and walks down
   * `QUALITY_LADDER` until a non-empty, non-encrypted manifest comes
   * back. Stays in the file as the cold-fallback for the rare cases
   * where `trackManifests` lies about what's playable.
   */
  private async legacyResolveStream(
    trackId: string,
    requestedQuality: string = 'HIGH',
  ): Promise<ResolvedStream> {
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

  /**
   * Probe Tidal for the set of audio formats actually published for a
   * track. One round trip on a cold KV cache, zero on a warm one.
   * Errors and unknown response shapes deliberately resolve to
   * `{qualities: []}` so the caller falls back to `legacyResolveStream`
   * instead of failing hard.
   */
  private async discoverQualities(trackId: string): Promise<DiscoveredQualities> {
    const cached = await this.readDiscoveryCache(trackId);
    if (cached) return cached;

    const url = new URL(`${OPENAPI_BASE}/trackManifests/${encodeURIComponent(trackId)}`);
    url.searchParams.set('adaptive', 'false');
    url.searchParams.set('manifestType', 'MPEG_DASH');
    url.searchParams.set('uriScheme', 'DATA');
    url.searchParams.set('usage', 'PLAYBACK');
    for (const f of ['HEAACV1', 'AACLC', 'FLAC', 'FLAC_HIRES']) {
      url.searchParams.append('formats', f);
    }

    const doFetch = async (token: string) => fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'User-Agent': 'TIDAL/2026.4.23 CFNetwork/1494.0.7 Darwin/23.4.0',
        'x-tidal-client-version': this.auth.getClientVersion(),
      },
    });

    let res: Response;
    try {
      let token = await this.auth.getAccessToken();
      res = await doFetch(token);
      if (res.status === 401) {
        token = await this.auth.getAccessToken({ force: true });
        res = await doFetch(token);
      }
    } catch {
      return { qualities: [] };
    }

    if (!res.ok) return { qualities: [] };

    let body: TrackManifestResponse;
    try {
      body = await res.json<TrackManifestResponse>();
    } catch {
      return { qualities: [] };
    }

    const formats = body.data?.attributes?.formats ?? [];
    // `drmData != null` → Tidal will only deliver this format behind
    // Widevine. `<audio>` tags can't speak Widevine, so treat the whole
    // track as no-discovery and let the legacy ladder probe (some
    // tracks have a clear HIGH/LOW even when HiRes is DRM-locked, the
    // ladder will find it).
    const drm = body.data?.attributes?.drmData != null;
    const usable = drm ? [] : formats;

    const mapped = usable
      .map((f) => FORMAT_TO_QUALITY[f])
      .filter((q): q is string => !!q);
    const unique = Array.from(new Set(mapped));
    unique.sort((a, b) => QUALITY_LADDER.indexOf(a) - QUALITY_LADDER.indexOf(b));

    const out: DiscoveredQualities = { qualities: unique };
    await this.writeDiscoveryCache(trackId, out);
    return out;
  }

  private async readDiscoveryCache(trackId: string): Promise<DiscoveredQualities | null> {
    if (!this.kv) return null;
    try {
      const cached = await this.kv.get<DiscoveredQualities>(
        `${DISCOVERY_CACHE_PREFIX}${trackId}`,
        'json',
      );
      if (!cached || !Array.isArray(cached.qualities)) return null;
      const filtered = cached.qualities.filter((q) => QUALITY_LADDER.includes(q));
      return { qualities: filtered };
    } catch {
      return null;
    }
  }

  private async writeDiscoveryCache(trackId: string, value: DiscoveredQualities): Promise<void> {
    if (!this.kv) return;
    try {
      await this.kv.put(
        `${DISCOVERY_CACHE_PREFIX}${trackId}`,
        JSON.stringify(value),
        { expirationTtl: DISCOVERY_CACHE_TTL_S },
      );
    } catch {
      /* ignore — cache is best-effort */
    }
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
