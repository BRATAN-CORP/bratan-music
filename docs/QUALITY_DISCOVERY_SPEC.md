# Quality discovery without fallback — design spec

> **Status:** Planning. Not implemented yet.
> **Scope:** Replace the quality-fallback ladder inside
> `TidalWeb.resolveStream` with a single discovery call. Nothing else
> changes.
> **Audience:** the next agent / engineer who picks this up.

---

## 1. Problem statement

Today, picking the right Tidal stream quality for a track is a *probe*:

1. Client asks for `quality=HI_RES_LOSSLESS`.
2. Worker calls `playbackinfopostpaywall` for that quality.
3. If Tidal returns no URLs, returns `encrypted`, or 4xx's, the worker
   walks down the ladder — `LOSSLESS` → `HIGH` → `LOW` — calling
   `playbackinfopostpaywall` once per rung until something succeeds,
   then hands the URL back.

That ladder is up to **4 round trips to Tidal** on the first listen of
a track. Today this is partly masked by a 30-day KV cache that
remembers "highest quality that worked for this trackId" so the next
listener skips the upper rungs — but:

- the **first** listener always pays.
- when Tidal flips a track between qualities (re-encoded masters,
  region availability changes), the cache poisons the answer for
  30 days.

We want exactly one round trip *for discovery*, then the existing
single-shot resolve. Simple.

---

## 2. The primitive

Tidal exposes the entire quality matrix for a track in one call:

```http
GET https://openapi.tidal.com/v2/trackManifests/:id?
    adaptive=false
    &formats=HEAACV1&formats=AACLC&formats=FLAC&formats=FLAC_HIRES
    &manifestType=MPEG_DASH
    &uriScheme=DATA
    &usage=PLAYBACK
Authorization: Bearer <token>
```

Response (relevant fields):

```json
{
  "data": {
    "id": "61121494",
    "type": "trackManifests",
    "attributes": {
      "trackPresentation": "FULL",
      "formats": ["FLAC"],
      "uri": "data:application/dash+xml;base64,...",
      "drmData": { "drmSystem": "WIDEVINE", ... }
    }
  }
}
```

The `formats` array is the answer. For this track, only `FLAC` is
available. If we'd asked for `FLAC_HIRES` we'd get told "not
available" without consuming a `playbackinfopostpaywall` call.

We don't need the `uri` (the base64 DASH MPD) for playback — that's
for Tidal's own DASH player. We just need the `formats` list.

---

## 3. The plan

Two small changes, no client code touched.

### 3.1 New: discover qualities

`worker/src/services/tidal/TidalWeb.ts` (or a sibling file):

```ts
const FORMAT_TO_QUALITY: Record<string, string> = {
  // openapi.tidal.com format names → our QUALITY_LADDER values.
  FLAC_HIRES: 'HI_RES_LOSSLESS',
  FLAC:       'LOSSLESS',
  AACLC:      'HIGH',
  HEAACV1:    'LOW',
};

const DISCOVERY_CACHE_TTL_S = 60 * 60 * 24 * 30; // 30 days, matches today.
const DISCOVERY_CACHE_PREFIX = 'tidal-track-formats:';

interface DiscoveredQualities {
  /** Subset of QUALITY_LADDER, sorted high → low. */
  qualities: string[];
}

async function discoverQualities(
  trackId: string,
  auth: TidalAuth,
  kv: KVNamespace | null,
): Promise<DiscoveredQualities> {
  if (kv) {
    const cached = await kv.get(`${DISCOVERY_CACHE_PREFIX}${trackId}`, 'json');
    if (cached) return cached as DiscoveredQualities;
  }

  const url = new URL(`https://openapi.tidal.com/v2/trackManifests/${trackId}`);
  url.searchParams.set('adaptive', 'false');
  url.searchParams.set('manifestType', 'MPEG_DASH');
  url.searchParams.set('uriScheme', 'DATA');
  url.searchParams.set('usage', 'PLAYBACK');
  for (const f of ['HEAACV1', 'AACLC', 'FLAC', 'FLAC_HIRES']) {
    url.searchParams.append('formats', f);
  }

  const token = await auth.getAccessToken();
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    // Don't fail loudly — fall back to "trust the requested quality"
    // so worst case we behave exactly like today's code does.
    return { qualities: [] };
  }
  const json = await res.json<TrackManifestsResponse>();
  const formats: string[] = json.data?.attributes?.formats ?? [];

  // Drop DRM-only formats. `drmData` non-null means widevine; for our
  // purposes that quality is unplayable on a plain `<audio>` tag, so
  // we treat it as unavailable. (If Tidal ever flips a track entirely
  // to DRM-only, qualities will be empty and we'll fall back to the
  // legacy ladder — see step 3.2.)
  const drm = !!json.data?.attributes?.drmData;
  const usable = drm ? [] : formats;

  const qualities = usable
    .map((f) => FORMAT_TO_QUALITY[f])
    .filter((q): q is string => !!q)
    .sort((a, b) => QUALITY_LADDER.indexOf(a) - QUALITY_LADDER.indexOf(b));

  const out: DiscoveredQualities = { qualities };
  if (kv) {
    await kv.put(
      `${DISCOVERY_CACHE_PREFIX}${trackId}`,
      JSON.stringify(out),
      { expirationTtl: DISCOVERY_CACHE_TTL_S },
    );
  }
  return out;
}
```

### 3.2 Change: `resolveStream` uses discovery, no ladder

```ts
async resolveStream(
  trackId: string,
  requestedQuality: string = 'HIGH',
): Promise<ResolvedStream> {
  const requestedIdx = QUALITY_LADDER.indexOf(requestedQuality.toUpperCase());
  const cap = requestedIdx >= 0 ? requestedIdx : QUALITY_LADDER.indexOf('HIGH');

  // 1. Discover what the track actually has. One round trip on a
  //    cold cache, zero round trips on a warm one.
  const { qualities } = await discoverQualities(trackId, this.auth, this.kv);

  // 2. Pick the highest available quality at-or-below the cap.
  let target: string | null = null;
  for (const q of qualities) {
    const idx = QUALITY_LADDER.indexOf(q);
    if (idx >= cap) {
      target = q;
      break;
    }
  }

  // 3. Cold-fallback: if discovery returned nothing (5xx, unknown
  //    response shape, DRM-only track), fall back to the old ladder
  //    *exactly as today*. This keeps the change a strict
  //    superset — discovery is an optimisation, never a regression.
  if (!target) {
    return this.legacyResolveStream(trackId, requestedQuality);
  }

  // 4. Single-shot playbackinfo for the picked quality.
  const info = await this.getPlaybackInfo(trackId, target);
  const manifest = this.decodeManifest(info.manifest, info.manifestMimeType);
  if (!manifest.urls.length) {
    return this.legacyResolveStream(trackId, requestedQuality);
  }
  if (manifest.encryptionType && manifest.encryptionType.toUpperCase() !== 'NONE') {
    return this.legacyResolveStream(trackId, requestedQuality);
  }

  return {
    url: manifest.urls[0],
    quality: target,
    codec: manifest.codecs,
    mimeType: manifest.mimeType,
  };
}

/**
 * The current ladder-walking implementation, renamed. Stays in the
 * file as a safety net: if `trackManifests` ever lies to us about
 * what's playable (e.g. lists FLAC but `playbackinfopostpaywall`
 * answers `encrypted` for that quality), we fall through here and
 * behave exactly like today.
 */
private async legacyResolveStream(
  trackId: string,
  requestedQuality: string,
): Promise<ResolvedStream> {
  /* current body of resolveStream — unchanged. */
}
```

That's the entire backend change. Two functions, ~80 lines.

### 3.3 Existing 30-day quality KV cache

Keep it. With discovery in place its job becomes "remember the
*resolved* quality" rather than "skip ladder rungs", but the cache
shape is identical and the 30-day TTL is fine. Discovery's own KV
cache is a separate prefix (`tidal-track-formats:`) so the two don't
collide.

If we ever want to be extra safe, write the resolved quality back
into the discovery cache too — that way if discovery is the freshest
truth the next listener picks the same answer instantly.

### 3.4 Frontend

**No change required.** `<audio>.src = /tracks/:id/stream?quality=…`
keeps working because the resolve still returns a CloudFront URL
proxied through `/tracks/audio`. The user gets faster time-to-first-
audio on cold tracks, nothing else moves.

If we want to expose "available qualities" to the UI later (e.g. a
chip on the now-playing card), add a `GET /tracks/:id/qualities`
endpoint that just returns `discoverQualities(...)`. Not required
for this work item — call it Phase 2 if the product ever asks for it.

---

## 4. Why not just MSE / a DASH player on the client?

Considered and rejected.

- Bundle hit (~150 KB gzipped for Shaka).
- DRM minefield: the same `trackManifests` response includes a
  `drmData` block with Widevine UUIDs. Today's `<audio>` flow
  sidesteps DRM entirely by going through Tidal's own
  `playbackinfopostpaywall` which negotiates a non-DRM CDN URL when
  one is available. A client-side DASH player would have to
  re-implement that, including key delivery on Safari / iOS.
- Solves a problem we don't have. We don't need adaptive bitrate, we
  don't need byte-exact seek-by-segment, and we don't want to remux.
  We just want to know what qualities a track has before asking for a
  specific one.

So: stay on `<audio>` + CloudFront URL, change only the inside of
`resolveStream`.

---

## 5. Why not skip the discovery call entirely?

A previous version of this spec proposed remuxing DASH segments on
the worker. That is overkill — we don't need the MPD's segment
URLs, just its `formats` array. One `trackManifests` call gives us
that, and the existing `playbackinfopostpaywall` pipeline gives us
the playable URL. Nothing in between.

The `formats` array could in theory be derived from the same
`playbackinfopostpaywall` response we already make, but that
endpoint is per-quality — it tells you "this quality is playable"
rather than "these qualities exist". `trackManifests` is the only
endpoint that answers the latter in one shot.

---

## 6. Migration & validation

- **No feature flag needed.** The legacy ladder stays in the file
  (renamed `legacyResolveStream`) as the cold-fallback for
  unexpected shapes from `trackManifests`. So the worst case is
  "discovery silently fails, we behave exactly like today".
- **Metrics to watch after deploy** (1 week):
  - p50 / p95 time inside `resolveStream`.
  - Ratio of legacy-fallback calls. If it's >5% something is
    wrong with the format-name mapping.
  - 502 rate on `/tracks/:id/stream` (should not move).
- Once metrics are clean for ~2 weeks, `legacyResolveStream` can be
  deleted.

## 7. Testing

- Unit test `discoverQualities` against the user-provided sample
  payload (one-format response → expect `["LOSSLESS"]`).
- Unit test the format-name mapping covers all four Tidal names.
- Unit test that an empty `formats[]` returns an empty
  `qualities[]` (and `resolveStream` falls back to legacy).
- Unit test that a `drmData != null` response is treated as no
  usable qualities.
- Manual QA: pick a HiRes track, a FLAC-only track, an AAC-only
  track. Confirm `getStreamUrl(id, 'HI_RES_LOSSLESS')` lands in one
  round trip after a cache wipe and produces audible playback in the
  app.

## 8. Out of scope

- Adaptive bitrate during playback.
- Pre-fetching the next track's qualities on shuffle/queue advance.
- Replacing the room stream proxy. Rooms call
  `tidal.resolveStream(...)` internally; they pick up the new
  discovery path for free.
- Exposing `qualities[]` in the UI. Phase 2 if/when the product
  asks for it.
