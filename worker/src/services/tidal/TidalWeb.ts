import { TidalAuth } from './TidalAuth';
import type { Env } from '../../types/env';
import {
  kvGetJson,
  kvGetText,
  kvPutJson,
  kvPutText,
} from '../streamCache';

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
// Empty discovery results (DRM-locked tracks, openapi.tidal.com auth
// failures, malformed responses) are cached briefly so the cache
// self-heals quickly once openapi.tidal.com starts cooperating again.
//
// Why 10 minutes (was 24h, was 1h before that):
// We hit the same incident twice in one day (28.05.2026 — see
// skills/projects/bratan-music/SKILL.md). A transient Tidal upstream
// blip caused `trackManifests/:id` to return malformed/empty bodies
// for ~30 tracks. With a 24h negative TTL, every one of those tracks
// stayed unplayable in the discovery-pinned + legacy-fallback path
// for the next 24 hours, surfacing as
// `PIPELINE_ERROR_READ: FFmpegDemuxer: demuxer seek failed` on the
// user side. The only fix was a manual `redis-cli DEL` against the
// `tidal-track-formats:*` and `tidal-track-quality:*` keyspaces.
//
// 10 minutes is short enough that any transient upstream blip
// self-clears within one normal coffee break, but long enough that
// repeated cold listens of a genuinely-broken track (DRM-only,
// catalogue-pruned) don't fan out an openapi.tidal.com round trip
// on every play — at most 6/hr per track per worker isolate.
//
// KV write budget check: free-tier cap is 1000 writes / namespace /
// day. With 10 min TTL, a single hot DRM-only track refreshes at
// most ~144 times/day across all isolates (caps lower in practice
// thanks to KV's edge caching). Genuinely-broken tracks are a
// small minority of plays, so total negative-cache writes stay
// well under 100/day in practice.
const DISCOVERY_NEGATIVE_CACHE_TTL_S = 10 * 60; // 10 minutes
const DISCOVERY_CACHE_PREFIX = 'tidal-track-formats:';
// When the discovery endpoint returns a global-auth failure (401 /
// 403 from openapi.tidal.com — bearer revoked, region-block, etc.),
// we trip a global breaker that suppresses ALL subsequent discovery
// calls for the TTL below. This avoids paying 1 wasted RTT per cold
// track while the endpoint simply can't work for anyone.
//
// 404 specifically does NOT trip the breaker. `trackManifests/<id>`
// returns 404 for edge-case individual tracks (DRM-only, region-
// locked, catalogue-pruned). Tripping a global hour-long breaker
// on a single track's 404 used to globally degrade cold-track
// resolution to the legacy ladder (up to 4 sequential 500–700 ms
// upstream calls per track), which surfaced as the user-visible
// "ждать по 3-5 секунд перед проигрышем". Per-track negative
// caching (DISCOVERY_NEGATIVE_CACHE_TTL_S) handles the "don't keep
// asking about this dead track" case without globally degrading
// the rest of the catalogue.
const DISCOVERY_BREAKER_KEY = 'tidal-discovery-breaker';
const DISCOVERY_BREAKER_TTL_S = 60 * 60; // 1 hour

export class TidalWeb {
  // Long-lived discovery / quality / breaker slots are stored in
  // `env.SESSIONS` (a KV namespace). The high-volume stream-URL slot
  // that previously dominated KV writes was migrated to an in-memory
  // memo (see `StreamUrlMemoCache` in `services/streamCache.ts`), so
  // the slots that remain here are bounded by the cold-track
  // discovery rate and stay comfortably under the 1000 writes/day
  // free-tier cap. The full rationale and the history of the earlier
  // (broken on workers.dev) Cache API attempt is in `streamCache.ts`.
  constructor(
    private auth: TidalAuth,
    private env: Env,
  ) {}

  async getStreamUrl(trackId: string, quality: string = 'HIGH'): Promise<string> {
    const resolved = await this.resolveStream(trackId, quality);
    return resolved.url;
  }

  /**
   * Per-call options that change cache-write behaviour.
   *
   * `skipCacheWrites=true` is set by the offline-download path so a
   * batch save (album / playlist) doesn't fan a write storm into the
   * `tidal-track-formats:` and `tidal-track-quality:` KV namespaces.
   * The cloudflare free tier caps KV writes at 1000 / namespace /
   * day; a 200-track playlist save was burning 400 of those slots
   * (one for discovery + one for the picked quality, per cold
   * track), and once the daily quota was exhausted EVERY write site
   * across the worker started failing for ALL users — hence the
   * "один юзер качает плейлист → весь сервис ложится" symptom
   * the user reported. Cache READS still happen (we still benefit
   * from a previously-warmed entry) and the play path still WRITES
   * (so listening to a track normally still warms the cache for
   * subsequent plays / downloads). Only the download path is
   * downgraded to read-only against the cache.
   */
  private skipCacheWrites = false;
  setSkipCacheWrites(skip: boolean): void {
    this.skipCacheWrites = skip;
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

    // If discovery returned no usable qualities, we're either looking
    // at a transient openapi.tidal.com blip (cached as `{qualities:[]}`
    // for DISCOVERY_NEGATIVE_CACHE_TTL_S) or a legitimately DRM-only
    // track. Either way, downstream legacy ladder resolution might
    // pick a quality whose stream URL passes our static manifest
    // checks (urls.length > 0, encryption=NONE) but still produces
    // an unplayable byte stream on the browser side (we've seen
    // `PIPELINE_ERROR_READ: FFmpegDemuxer: demuxer seek failed`
    // during these blips — see SKILL.md, 28.05.2026 incident).
    //
    // We can't reliably distinguish "blip" from "DRM-only" inside the
    // worker, so we pessimistically write the legacy-discovered
    // quality with the SAME short TTL as the empty-discovery negative
    // cache. That way, if it really was a blip, both the discovery
    // cache and the quality cache self-heal at the same cadence; if
    // it really is DRM-only, we just pay a few extra ladder walks
    // per hour for that one track instead of pinning a possibly-wrong
    // quality for 30 days. The quality cache only ever feeds back
    // into legacyResolveStream as a starting ladder index, so the
    // worst case here is "walk one extra ladder rung on cold play".
    const discoveryEmpty = qualities.length === 0;

    if (!target) {
      return this.legacyResolveStream(trackId, requestedQuality, { shortQualityTtl: discoveryEmpty });
    }

    let info: PlaybackInfo;
    try {
      info = await this.getPlaybackInfo(trackId, target);
    } catch {
      return this.legacyResolveStream(trackId, requestedQuality, { shortQualityTtl: discoveryEmpty });
    }

    let manifest: BtsManifest;
    try {
      manifest = this.decodeManifest(info.manifest, info.manifestMimeType);
    } catch {
      return this.legacyResolveStream(trackId, requestedQuality, { shortQualityTtl: discoveryEmpty });
    }

    if (!manifest.urls.length) {
      return this.legacyResolveStream(trackId, requestedQuality, { shortQualityTtl: discoveryEmpty });
    }
    if (manifest.encryptionType && manifest.encryptionType.toUpperCase() !== 'NONE') {
      return this.legacyResolveStream(trackId, requestedQuality, { shortQualityTtl: discoveryEmpty });
    }

    // Memoise the resolved quality in the existing
    // `tidal-track-quality:` KV namespace too, so if discovery ever
    // fails for this track in the future the legacy ladder fallback
    // also lands in one round trip. Suppressed on download requests
    // (see {@link skipCacheWrites}).
    if (!this.skipCacheWrites) {
      await this.writeCachedQuality(trackId, target);
    }

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
    opts: { shortQualityTtl?: boolean } = {},
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
        // skips the upper rungs of the ladder. Suppressed on download
        // requests (see {@link skipCacheWrites}). If we got here via
        // a discovery miss (caller passed `shortQualityTtl: true`),
        // pin the quality only for DISCOVERY_NEGATIVE_CACHE_TTL_S so
        // it self-heals at the same cadence as the discovery cache.
        if (!this.skipCacheWrites) {
          await this.writeCachedQuality(
            trackId,
            quality,
            opts.shortQualityTtl ? DISCOVERY_NEGATIVE_CACHE_TTL_S : undefined,
          );
        }
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
    // Global circuit breaker: if a previous call discovered that
    // openapi.tidal.com is unreachable (wrong auth scope, 404,
    // etc.), skip all per-track attempts for up to 1 hour.
    if (await this.isDiscoveryBreakerOpen()) {
      return { qualities: [] };
    }

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

    // Helper that always caches the result before returning, so a
    // failed discovery doesn't replay the wasted RTT on every cold
    // listen. Empty results are cached short (1h) so the cache
    // self-heals once openapi.tidal.com starts cooperating again;
    // populated results are cached long (30d) like the spec asked.
    const finalize = async (qualities: string[]): Promise<DiscoveredQualities> => {
      const value: DiscoveredQualities = { qualities };
      // Bulk-download path: read but don't write. See
      // {@link skipCacheWrites} for the KV-quota rationale.
      if (!this.skipCacheWrites) {
        await this.writeDiscoveryCache(
          trackId,
          value,
          qualities.length > 0 ? DISCOVERY_CACHE_TTL_S : DISCOVERY_NEGATIVE_CACHE_TTL_S,
        );
      }
      return value;
    };

    let res: Response;
    try {
      let token = await this.auth.getAccessToken();
      res = await doFetch(token);
      if (res.status === 401) {
        token = await this.auth.getAccessToken({ force: true });
        res = await doFetch(token);
      }
    } catch (err) {
      console.warn(
        `[TidalWeb] discoverQualities ${trackId} fetch failed:`,
        err instanceof Error ? err.message : err,
      );
      return finalize([]);
    }

    if (!res.ok) {
      let detail = '';
      try { detail = (await res.text()).slice(0, 200); } catch { /* ignore */ }
      console.warn(
        `[TidalWeb] discoverQualities ${trackId} non-OK status=${res.status} body=${detail}`,
      );
      // Trip the global breaker only on 401 / 403 — those signal that
      // the bearer or whatever cross-region auth `openapi.tidal.com`
      // requires has stopped working *globally*, in which case
      // suppressing every subsequent cold-track call for the next hour
      // is a real win.
      //
      // Critically we do NOT trip the breaker on 404. The
      // `trackManifests/<id>` endpoint legitimately returns 404 for
      // individual edge-case tracks — DRM-only, region-locked,
      // catalogue-pruned — and tripping the global breaker on a
      // single track's 404 caused every other COLD track in the next
      // hour to fall back through the legacy ladder (up to 4 sequential
      // upstream RTTs of 500–700 ms each), which is what the user was
      // seeing as "треки стали как будто дольше загружаться, жду по
      // 3-5 секунд перед проигрышем". The per-track negative-cache
      // (DISCOVERY_NEGATIVE_CACHE_TTL_S, 1 h) already handles the
      // "don't keep re-asking openapi about this specific dead track"
      // case without globally degrading discovery for everyone else.
      //
      // Same skip-on-download policy: a bulk download fan-out
      // shouldn't burn the breaker write either, since the play path
      // has had ample opportunity to set it during normal listening.
      if ((res.status === 401 || res.status === 403) && !this.skipCacheWrites) {
        await this.tripDiscoveryBreaker();
      }
      return finalize([]);
    }

    let body: TrackManifestResponse;
    try {
      body = await res.json<TrackManifestResponse>();
    } catch (err) {
      console.warn(
        `[TidalWeb] discoverQualities ${trackId} json decode failed:`,
        err instanceof Error ? err.message : err,
      );
      return finalize([]);
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

    return finalize(unique);
  }

  private async readDiscoveryCache(trackId: string): Promise<DiscoveredQualities | null> {
    const cached = await kvGetJson<DiscoveredQualities>(
      this.env.SESSIONS,
      `${DISCOVERY_CACHE_PREFIX}${trackId}`,
    );
    if (!cached || !Array.isArray(cached.qualities)) return null;
    const filtered = cached.qualities.filter((q) => QUALITY_LADDER.includes(q));
    return { qualities: filtered };
  }

  private async writeDiscoveryCache(
    trackId: string,
    value: DiscoveredQualities,
    ttlSeconds: number = DISCOVERY_CACHE_TTL_S,
  ): Promise<void> {
    await kvPutJson(
      this.env.SESSIONS,
      `${DISCOVERY_CACHE_PREFIX}${trackId}`,
      value,
      ttlSeconds,
    );
  }

  // ── Global discovery circuit breaker ────────────────────────────
  //
  // When openapi.tidal.com is unreachable (returns 403/404 because
  // the worker's user-bearer token isn't accepted by the developer
  // platform), hammering it per-track wastes one RTT on every cold
  // listen. The breaker caches a single flag for 1h; while it's
  // set, `discoverQualities` bails immediately.

  private async isDiscoveryBreakerOpen(): Promise<boolean> {
    const v = await kvGetText(this.env.SESSIONS, DISCOVERY_BREAKER_KEY);
    return v != null;
  }

  private async tripDiscoveryBreaker(): Promise<void> {
    await kvPutText(
      this.env.SESSIONS,
      DISCOVERY_BREAKER_KEY,
      '1',
      DISCOVERY_BREAKER_TTL_S,
    );
    console.warn(
      `[TidalWeb] discovery breaker tripped — suppressing openapi.tidal.com calls for ${DISCOVERY_BREAKER_TTL_S}s`,
    );
  }

  private async readCachedQuality(trackId: string): Promise<string | null> {
    const raw = await kvGetText(
      this.env.SESSIONS,
      `${QUALITY_CACHE_PREFIX}${trackId}`,
    );
    if (!raw) return null;
    const upper = raw.toUpperCase();
    return QUALITY_LADDER.includes(upper) ? upper : null;
  }

  private async writeCachedQuality(
    trackId: string,
    quality: string,
    ttlSeconds: number = QUALITY_CACHE_TTL_S,
  ): Promise<void> {
    await kvPutText(
      this.env.SESSIONS,
      `${QUALITY_CACHE_PREFIX}${trackId}`,
      quality.toUpperCase(),
      ttlSeconds,
    );
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
