# Quality discovery without fallback — design spec

> **Status:** Planning. Not implemented yet.
> **Owner:** TBA.
> **Audience:** the next agent / engineer who picks this up.

---

## 1. Problem statement

Today, picking the right Tidal stream quality for a track is a *probe*:

1. Client requests `GET /tracks/:id/stream?quality=HI_RES_LOSSLESS`.
2. Worker calls Tidal `getStreamUrl` for `HI_RES_LOSSLESS`.
3. If Tidal answers `404 / 403 / "not available at this quality"`, worker
   walks down the ladder — `LOSSLESS` → `HIGH` → `LOW` — until something
   succeeds, then hands the URL back.

That ladder traversal is a **probe**: each rung is one round trip to
Tidal. On a cold cache (a track the user has never streamed before in
this account) the worker does up to 4 round trips before it can answer
the client. The user sees this as the spinner sitting longer than it
should and, occasionally, an audible delay between clicking the track
and hearing audio.

The current code masks this with a 30-day KV cache of "highest quality
that worked for this trackId", but the first listen is still slow, and
when Tidal flips a track between qualities (which they do — masters
get re-encoded, region availability changes) the cache poisons the
result for 30 days.

We want the worker to **answer in one round trip**: ask Tidal "what
qualities does this track have?", get the full list, and return the
highest one ≤ user's preferred ceiling.

The user found the right primitive:

```http
GET https://openapi.tidal.com/v2/trackManifests/:id?
    adaptive=false
    &formats=HEAACV1&formats=AACLC&formats=FLAC&formats=FLAC_HIRES
    &manifestType=MPEG_DASH
    &uriScheme=DATA
    &usage=PLAYBACK
Authorization: Bearer <token>
```

Response body (relevant excerpt):

```json
{
  "data": {
    "id": "61121494",
    "type": "trackManifests",
    "attributes": {
      "trackPresentation": "FULL",
      "uri": "data:application/dash+xml;base64,...",
      "formats": ["FLAC"],
      "drmData": { "drmSystem": "WIDEVINE", ... },
      "albumAudioNormalizationData": { ... },
      "trackAudioNormalizationData": { ... }
    }
  }
}
```

The `formats` array tells us which audio codecs Tidal has for this
track. The base64-decoded `uri` is a DASH MPD that enumerates each
representation (codec, sample rate, bit depth, bandwidth) and the
segment URLs.

That's the full picture in one call.

---

## 2. The catch

`trackManifests` returns a **DASH manifest** (or HLS, depending on
`manifestType`), not a single FLAC/M4A URL. DASH means:

- The track is split into ~4 second `.mp4` segments served from
  CloudFront under signed URLs that expire ~1 hour after issue.
- Browsers cannot play DASH natively from `<audio>`. The decode path
  has to go through Media Source Extensions (MSE) with a
  segment-fetching scheduler in JS.
- DRM (Widevine `cbcs`) is wired in at the `ContentProtection` element
  level, even for FLAC. Browsers happen to accept FLAC-in-DASH without
  Widevine sometimes (because the Widevine block is lazy-evaluated), but
  it is not guaranteed and breaks on Safari.

So we cannot just call `trackManifests`, parse the URL out, and hand
it to `<audio>.src` like we do today. **Two architectural paths exist;
we have to pick one.**

---

## 3. Two paths

### Path A — DASH on the client (`hls.js`/`shaka-player`)

The client takes the responsibility of being a DASH/HLS player:

```
Client                                      Worker                  Tidal
──────                                      ──────                  ─────
GET /tracks/:id/manifest                  ─►
                                            GET /v2/trackManifests ─►
                                            ◄─ {formats, uri (b64)}
                                            decode b64
                                            extract representation list
                                          ◄─ { quality, mpd, codec, bitrate }
new Shaka(audioEl).load(mpd)
   ├─ fetch /tracks/audio?url=<segment_1> ─► proxy ──► CloudFront
   ├─ fetch /tracks/audio?url=<segment_2> ─► proxy ──► CloudFront
   └─ ...                                   ...
```

**Pros**

- Worker does one round trip per track. Quality discovery is
  literally "read the `formats` array".
- Adaptive bitrate is "free" — Shaka picks the best representation
  based on bandwidth.
- No re-encoding cost on the worker.

**Cons**

- New big dep on the client. Shaka is ~150 KB gzipped. The current
  bundle is already 233 KB gzipped — that's a +60% bundle size hit
  unless we lazy-load (which we should).
- DRM. FLAC tracks ship with a Widevine `ContentProtection` block.
  In practice the browser will play unencrypted FLAC-in-DASH without
  asking for keys, but **only if** we strip the `<ContentProtection>`
  elements from the MPD before handing it to Shaka. That's a fragile
  hack — Tidal could start actually encrypting FLAC any week.
- Safari compatibility is poor. Native HLS is fine but DASH requires
  Shaka, and Shaka on Safari requires native MSE which iOS Safari only
  exposes inside `<video>` (not `<audio>`). We'd have to render a
  hidden `<video>` for audio playback on iOS, which collides with
  the existing `useAudioPlayer` graph routing through `<audio>` +
  WebAudio.
- HLS+CBCS + Widevine combination is a minefield. We have to verify
  per-region availability — Tidal may serve a non-DRM AAC track for
  one region and DRM-FLAC for another.

### Path B — Worker remuxes DASH segments into a single stream

The worker becomes a smart proxy that hides DASH from the client:

```
Client                                      Worker                       Tidal
──────                                      ──────                       ─────
GET /tracks/:id/stream?quality=…          ─►
                                            GET /v2/trackManifests     ─►
                                            ◄─ {formats, uri (b64)}
                                            parse MPD
                                            pick representation
                                            for each segment:
                                              fetch CloudFront seg     ─►
                                              ◄─ raw bytes
                                              concat / remux
                                          ◄─ Content-Type: audio/flac
                                              Content-Length: <total>
                                              Accept-Ranges: bytes
                                              <body: full FLAC/M4A>
audio.src = url; audio.play()
```

The worker either:

- **B1.** Concats raw segments and emits a single `audio/mp4` (since
  DASH segments already are `.mp4` boxes — strip the `moof` and append
  `mdat` payloads, fix the `mvhd` duration, ship). This is the
  "fragmented MP4 → single MP4" remux. Crucially, **no decode/encode**
  — bytes are just rewrapped. CPU cost is bounded.

- **B2.** Decodes segments and re-encodes to a single FLAC/MP3. Far
  more CPU. We do not want this on a worker.

Always pick B1.

**Pros**

- Client stays oblivious. Plain `<audio>.src = url`. No new deps.
- Existing CORS-proxy + Range-request handling in `/tracks/audio`
  applies as-is.
- DRM problem deferred — if Tidal returns a DRM-only representation,
  the worker just doesn't pick it (or returns an explicit "not playable
  without DRM" error, same UX as a 402).
- iOS Safari works without changes.
- Quality discovery happens once: the worker reads `formats` and the
  decoded MPD, and the response shape can include
  `availableQualities: ["FLAC_HIRES", "FLAC", "AACLC"]` so the UI can
  show "available at" labels without further round trips.

**Cons**

- Worker has to parse DASH MPD XML. Cloudflare Workers don't ship a
  DOM parser; we need a tiny streaming parser (e.g.
  [`fast-xml-parser`](https://www.npmjs.com/package/fast-xml-parser),
  ~15 KB). That's fine.
- Worker has to fetch all segments before it can stream. Two options:
  - **B1a.** Pre-fetch all → write into a single ReadableStream → ship.
    Latency: ~track length / N \* RTT. For a 4-min track at 4 s
    segments = 60 segments \* ~50 ms = 3 s of upfront delay. Bad.
  - **B1b.** Streaming concat: open the response stream immediately,
    emit each segment as soon as we have it, in order. The `<audio>`
    element starts decoding as bytes arrive. This is what the existing
    `/tracks/audio` proxy already does for direct CloudFront URLs —
    we just have to adapt it to walk the segment list.
- Range requests. `<audio>` issues `Range: bytes=0-` on initial probe
  and follow-up Ranges for seeks. Stitching ranges across segment
  boundaries is non-trivial. Two simplifications:
  - For initial playback, ignore Range and stream the full file.
    Browsers are happy as long as `Content-Length` is reported.
  - For seek, look up which segment covers the target time (the MPD
    has a `SegmentTimeline` with per-segment `t` / `d` so we know
    exactly), skip earlier segments, start streaming from there. Fix
    up the Range response headers so the browser believes it's
    getting the requested byte range.
- We have to decode the base64 MPD on every stream request unless we
  cache it. Caching the parsed MPD by `(trackId, quality)` for ~1
  hour (Tidal segment URLs expire on roughly that schedule) is fine.

---

## 4. Recommendation

**Implement Path B1b (streaming-remux on the worker) for now.** It's
the smaller blast radius:

- One service file change on the worker. No client changes for
  playback. UI gets a new endpoint to call for "what qualities does
  this track have" (read from the same trackManifests response).
- iOS / Safari work out of the box.
- DRM tracks are quietly skipped, same UX as today's "track not
  available".

Reserve Path A for the future if/when:

- Adaptive bitrate becomes a feature ask (currently the user has a
  single setting in Profile and we honour it).
- Tidal flips most of the catalog to DRM-required and the worker
  remux can no longer get clean segments.

---

## 5. Concrete implementation plan (Path B1b)

### 5.1 Worker: new manifest service

`worker/src/services/tidal/TidalManifestService.ts`

```ts
import { TidalService } from './TidalService';

export interface TrackQuality {
  /** Tidal quality name: 'FLAC_HIRES' | 'FLAC' | 'AACLC' | 'HEAACV1'. */
  name: string;
  codec: string;            // 'flac', 'mp4a.40.2', etc.
  bitrate: number;          // bps
  sampleRate: number;
  bitDepth?: number;        // FLAC only
  drmRequired: boolean;
}

export interface TrackManifest {
  trackId: string;
  qualities: TrackQuality[];
  /** `data:application/dash+xml;base64,…` decoded into raw XML. */
  mpdXml: string;
  /** Cache TTL hint — mirror Tidal's segment-URL expiry. */
  ttlSeconds: number;
}

export class TidalManifestService {
  constructor(private env: Env) {}

  async fetchManifest(trackId: string): Promise<TrackManifest> {
    // 1. Try KV cache.
    const cached = await this.env.KV.get(`manifest:${trackId}`, 'json');
    if (cached && cached.expiresAt > Date.now()) return cached.manifest;

    // 2. Hit Tidal trackManifests with all four formats. We pass
    //    every format every time — Tidal returns only the ones the
    //    track actually has, so this is the cheapest way to get the
    //    full catalogue in one call.
    const tidal = new TidalService(this.env);
    const token = await tidal.getServiceToken(); // existing helper
    const url = new URL(
      `https://openapi.tidal.com/v2/trackManifests/${trackId}`,
    );
    url.searchParams.set('adaptive', 'false');
    url.searchParams.set('manifestType', 'MPEG_DASH');
    url.searchParams.set('uriScheme', 'DATA');
    url.searchParams.set('usage', 'PLAYBACK');
    for (const f of ['HEAACV1', 'AACLC', 'FLAC', 'FLAC_HIRES']) {
      url.searchParams.append('formats', f);
    }

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      throw new Error(`trackManifests ${res.status}`);
    }
    const json = await res.json();
    const attrs = json.data.attributes;

    // 3. Decode base64 MPD.
    const dataUri = attrs.uri as string; // 'data:application/dash+xml;base64,…'
    const b64 = dataUri.split('base64,')[1];
    const mpdXml = atob(b64);

    // 4. Parse representations from the MPD.
    const qualities = parseQualities(mpdXml);

    const manifest: TrackManifest = {
      trackId,
      qualities,
      mpdXml,
      ttlSeconds: 3300, // 55 min — safely under the 1 h CloudFront TTL.
    };
    await this.env.KV.put(
      `manifest:${trackId}`,
      JSON.stringify({
        manifest,
        expiresAt: Date.now() + manifest.ttlSeconds * 1000,
      }),
      { expirationTtl: manifest.ttlSeconds },
    );
    return manifest;
  }
}
```

`parseQualities(mpdXml)` reads `<Representation>` nodes via
`fast-xml-parser`, extracts `codecs` / `bandwidth` / `audioSamplingRate`
/ optional bit-depth, and flips `drmRequired` true if any
`<ContentProtection>` is present on that representation's parent
`<AdaptationSet>` (excluding the `mp4protection:2011` placeholder which
Tidal sets even on unencrypted tracks — match by `schemeIdUri` to the
`urn:uuid:edef8ba9-…` Widevine UUID specifically).

### 5.2 Worker: new stream-remux route

`worker/src/routes/tracks.ts` gains:

```ts
// GET /tracks/:id/manifest → JSON describing all qualities. UI uses
// this to render quality chips, room-host pre-checks, etc.
tracks.get('/:id/manifest', async (c) => {
  const id = c.req.param('id');
  const svc = new TidalManifestService(c.env);
  try {
    const m = await svc.fetchManifest(id);
    return c.json({
      trackId: id,
      qualities: m.qualities.filter((q) => !q.drmRequired),
    });
  } catch (err) {
    return c.json({ error: errMessage(err) }, 502);
  }
});

// GET /tracks/:id/stream-v2?quality=FLAC → audio/mp4 streaming response.
// Same shape as today's /tracks/:id/stream but no quality fallback ladder.
tracks.get('/:id/stream-v2', async (c) => {
  const id = c.req.param('id');
  const requested = (c.req.query('quality') ?? 'LOSSLESS').toUpperCase();
  const svc = new TidalManifestService(c.env);
  const m = await svc.fetchManifest(id);

  // Pick the representation closest to requested without going over.
  const rep = pickRepresentation(m.qualities, requested);
  if (!rep) return c.json({ error: 'Не доступно' }, 404);

  return streamRemux(c.env, m.mpdXml, rep, c.req.header('Range'));
});
```

`streamRemux` walks the MPD's `<SegmentTemplate initialization=… media=… startNumber=…>` block, fetches the init segment + each media segment in order, and emits a `ReadableStream` to the client:

```ts
async function streamRemux(
  env: Env,
  mpdXml: string,
  rep: Representation,
  rangeHeader: string | undefined,
): Promise<Response> {
  const segments = enumerateSegments(mpdXml, rep);
  // segments = [initUrl, mediaUrl_1, mediaUrl_2, …]

  const totalBytes = segments.reduce((acc, s) => acc + s.expectedBytes, 0);
  const startSeg = findStartSegment(segments, rangeHeader);
  // For the first cut, ignore Range and stream from segment 0.

  const { readable, writable } = new TransformStream();
  (async () => {
    const writer = writable.getWriter();
    try {
      for (let i = startSeg; i < segments.length; i++) {
        const r = await fetch(segments[i].url);
        if (!r.body) throw new Error(`segment ${i} empty`);
        const reader = r.body.getReader();
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          await writer.write(value);
        }
      }
    } catch (err) {
      console.error('[stream-v2] remux failed', err);
    } finally {
      await writer.close();
    }
  })();

  return new Response(readable, {
    status: 200,
    headers: {
      'Content-Type': mimeFor(rep.codec), // 'audio/mp4' or 'audio/flac'
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store',
    },
  });
}
```

> **Important.** Cloudflare Workers limit subrequests per request: free
> tier 50, paid 1000. A 4-min track at 4 s segments = 60 segments
> *in addition to* the manifest fetch and any KV call. We need the
> paid plan's 1000 subrequest cap. Verify in `wrangler.toml` before
> shipping.

### 5.3 Client: quality chips + queue eviction

`src/hooks/useAudioPlayer.ts`:

- New helper `fetchQualities(trackId)` calls `/tracks/:id/manifest`.
- The fallback ladder loop (lines ~803-849 today) is gone.
  `loadTrack` now does:
    1. `fetchQualities(trackId)`
    2. Pick the highest available `≤ tidalQuality`.
    3. `audio.src = /tracks/:id/stream-v2?quality=<picked>`
    4. `audio.load()`
    5. If it fails, surface the error directly — no probing.

- Existing `getNextFallbackQuality` stays as a deprecated helper for
  the old `/stream` endpoint until we delete the v1 path.

`src/components/features/QualityChip.tsx` (new):

- Reads `useQualityForTrack(trackId)` (a small wrapper over react-query
  pointing at `/tracks/:id/manifest`).
- Renders chips for each quality the track actually has, marking the
  one currently in use.

Integration points: TrackRow, NowPlaying, and (most importantly) the
room "Track picker" — host can see at a glance which qualities the
selected track supports before forcing it on guests.

### 5.4 Migration

- Land the new endpoints behind a feature flag (e.g.
  `STREAM_V2_ENABLED` env var on the worker).
- Frontend reads the flag from `/health`. When false, falls back to
  the existing `/tracks/:id/stream` ladder.
- Run both code paths side-by-side for ~1 week. Compare:
  - p50 / p95 time-to-first-audio.
  - Failure rate (segment fetch errors, MPD parse errors).
- Once v2 wins on both metrics, delete the v1 path and the
  `getNextFallbackQuality` helper.

### 5.5 Testing

- Unit-test `parseQualities` against the user-provided MPD sample
  (the b64 in `QUALITY_DISCOVERY_SPEC.md` is a real production
  payload).
- Integration test: a Vitest scenario that uses a stubbed Tidal
  fetch returning the same payload and asserts
  `/tracks/:id/manifest` returns `[{ name: 'FLAC', drmRequired:
  false }]`.
- Manual QA: pick three tracks (one HiRes, one FLAC-only, one
  AAC-only), confirm `<audio>` plays end-to-end on Chrome, Firefox,
  Safari, iOS Safari, Android Chrome.

### 5.6 Out of scope (for this spec)

- Adaptive bitrate switching mid-track.
- Pre-fetching the next track's manifest. (The current preload-next
  logic in `useAudioPlayer.ts` already calls the v1 stream endpoint
  for the next track to warm the audio buffer; switch it to v2 once
  v2 is the default.)
- Replacing the room stream proxy. Rooms can keep using
  `/rooms/:id/stream/tidal/:rawId` which itself can call the v2
  remux internally — the proxy contract for guests doesn't change.

---

## 6. Open questions for the implementer

- **Subrequest cap.** Verify our worker plan's subrequest cap covers
  ~60 segments per stream + 1 manifest fetch + 1 KV read. If not, we
  need to either (a) ask Cloudflare for a higher cap or (b) cache the
  full first-segment-batch and serve subsequent listeners from KV.
- **Memory cap.** Streaming-remux must not buffer the full track in
  worker memory. The TransformStream pattern above is intentional —
  do not change it to "fetch all then write".
- **Tidal token rotation.** `TidalService.getServiceToken` is the
  existing helper. Confirm it's safe to call in a hot path (it's
  cached in KV with a sane TTL, but check before the first round of
  load tests).
- **Fallback for DRM-only tracks.** Right now we surface "not
  available". A subset of tracks (mostly HiRes masters) are DRM-only.
  Decide UX: skip silently? Show an error with a link to the
  subscription paywall? Mention to the room host so they don't pick
  one as a queue item?
