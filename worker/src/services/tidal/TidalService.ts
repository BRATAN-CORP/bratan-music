import type { Env } from '../../types/env';
import type {
  Track,
  Album,
  Artist,
  SearchResult,
  MusicService,
  ExplorePage,
  ExploreModule,
  ExplorePlaylist,
  ExplorePageLink,
} from '../../types/music';
import { TidalAuth } from './TidalAuth';
import { TidalApi } from './TidalApi';
import type {
  TidalTrackRaw,
  TidalAlbumRaw,
  TidalArtistRaw,
  TidalPageModuleRaw,
  TidalPlaylistRaw,
  TidalPageLinkRaw,
  TidalPagedListRaw,
} from './TidalApi';
import { TidalWeb } from './TidalWeb';
import { kvGetText, kvPutText } from '../streamCache';

const IMG_BASE = 'https://resources.tidal.com/images';
const VIDEO_BASE = 'https://resources.tidal.com/videos';

/**
 * Wrap a tidal-CDN URL with our `/covers/proxy?url=...` endpoint so the
 * browser fetches the image through nginx/api instead of hitting
 * `resources.tidal.com` directly. The CDN regularly returns 403 for
 * direct cross-origin requests from random client IPs (geo / hot-link
 * defence), even though the same URL works server-side from the API
 * container. Routing through the proxy fixes the rash of `Failed to
 * load resource: 403` errors on cover art and genre tiles reported by
 * the user. The path is relative — the browser resolves it against
 * the page origin, so this works for both `bratan-music.eu.cc` and
 * any future custom domains without rebuilding.
 *
 * Video covers (.mp4) are NOT proxied here: the `/covers/proxy`
 * endpoint is image-only by design (long-cache, no Range support),
 * and the video element handles `resources.tidal.com` fine on its
 * own because it doesn't need a CORS round-trip to play.
 */
function proxiedImage(raw: string): string {
  return `/api/covers/proxy?url=${encodeURIComponent(raw)}`;
}

function coverUrl(coverId: string | null | undefined, size: number = 640): string | undefined {
  if (!coverId) return undefined;
  return proxiedImage(`${IMG_BASE}/${coverId.replace(/-/g, '/')}/${size}x${size}.jpg`);
}

/**
 * Construct the URL for an animated cover (mp4) at the given size. Only some
 * Tidal albums expose this — when present the API returns a UUID under
 * `videoCover`, identical encoding to image covers (dashes → slashes).
 */
function videoCoverUrl(videoId: string | null | undefined, size: number = 1280): string | undefined {
  if (!videoId) return undefined;
  return `${VIDEO_BASE}/${videoId.replace(/-/g, '/')}/${size}x${size}.mp4`;
}

function artistImageUrl(pictureId: string | null | undefined, size: number = 480): string | undefined {
  if (!pictureId) return undefined;
  return proxiedImage(`${IMG_BASE}/${pictureId.replace(/-/g, '/')}/${size}x${size}.jpg`);
}

/**
 * Dedupe contributor list while preserving upstream order. Tidal
 * occasionally repeats the same artist across `MAIN`/`FEATURED`
 * entries — we keep just the first occurrence so the UI doesn't
 * render the same name twice.
 */
function dedupeArtistRefs(list: { id: number; name: string }[] | undefined): { id: string; name: string }[] | undefined {
  if (!list || list.length === 0) return undefined;
  const seen = new Set<string>();
  const out: { id: string; name: string }[] = [];
  for (const a of list) {
    const id = String(a.id);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ id, name: a.name });
  }
  return out.length > 0 ? out : undefined;
}

function mapTrack(raw: TidalTrackRaw): Track {
  const artists = dedupeArtistRefs(raw.artists);
  const mainArtist = raw.artist ?? raw.artists?.[0];
  return {
    id: String(raw.id),
    source: 'tidal',
    title: raw.title + (raw.version ? ` (${raw.version})` : ''),
    artist: artists?.map(a => a.name).join(', ') || mainArtist?.name || 'Unknown Artist',
    artistId: mainArtist ? String(mainArtist.id) : undefined,
    artists,
    album: raw.album?.title ?? '',
    albumId: raw.album ? String(raw.album.id) : undefined,
    duration: raw.duration,
    coverUrl: coverUrl(raw.album?.cover),
    coverVideoUrl: videoCoverUrl(raw.album?.videoCover),
    explicit: raw.explicit ?? false,
    quality: raw.audioQuality ?? 'HIGH',
  };
}

function dedupeById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Map<string, T>();
  for (const i of items) if (!seen.has(i.id)) seen.set(i.id, i);
  return Array.from(seen.values());
}

/**
 * Unwrap a single item from a Tidal `pagedList` so we end up with a
 * raw album record — or `undefined` if the item is anything else
 * (playlist, mix, video, track, page-link, ad placeholder).
 *
 * Tidal's editorial "page module" pagedLists (the ones reached via
 * the opaque `dataApiPath` returned alongside the artist page's
 * `ARTIST_ALBUMS` / `ARTIST_TOP_SINGLES` / `ARTIST_COMPILATIONS`
 * modules) sometimes return:
 *
 *   - direct album rows: `{ id: 12345, title: …, type: 'ALBUM', … }`
 *   - wrapped rows:      `{ item: { id: 12345, … }, type: 'ALBUM' }`
 *   - heterogeneous rows: `{ item: { uuid: …, title: … }, type: 'PLAYLIST' }`
 *                         `{ item: { id: … }, type: 'MIX' | 'VIDEO' }`
 *
 * The previous implementation simply cast `pagedList.items` to
 * `TidalAlbumRaw[]` and `mapAlbum`'d every entry, so playlists and
 * mixes leaked into the artist's "All albums" feed and rendered as
 * malformed album cards (the user reported "on the /albums page more
 * than half are someone's playlists from Tidal"). This helper drops
 * any non-album entity and unwraps the rest.
 */
function unwrapPagedAlbum(input: unknown): TidalAlbumRaw | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const raw = input as {
    item?: unknown;
    data?: unknown;
    type?: unknown;
    id?: unknown;
    uuid?: unknown;
  };
  // Wrapped shapes: `{ item, type }` (v1 page modules) and
  // `{ data, type }` (v2 `/v2/artist/<MODULE>/view-all` view-all
  // pagination). Reject upfront if the wrapper labels this as
  // something we know isn't an album.
  const wrapped = raw.item ?? raw.data;
  if (wrapped && typeof wrapped === 'object') {
    if (typeof raw.type === 'string' && raw.type.toUpperCase() !== 'ALBUM') {
      return undefined;
    }
    return unwrapPagedAlbum(wrapped);
  }
  // Direct shape — albums always carry a numeric `id`. Playlists use
  // string `uuid`s; mixes use prefixed string ids; ad placeholders
  // have neither. Anything that doesn't pass the numeric-id check is
  // not an album for our purposes.
  if (typeof raw.id !== 'number') return undefined;
  return input as TidalAlbumRaw;
}

/**
 * Strip release-edition decoration so that two album entries that
 * differ only by suffix — e.g. "Scorpion" vs "Scorpion (Deluxe)" vs
 * "Scorpion - Deluxe Edition" — collapse to the same fingerprint.
 * Also strips `Clean` / `Explicit` / `Edited (Version)` markers so
 * the explicit-twin dedupe (see {@link preferExplicitAlbums}) sees
 * the same fingerprint for `Album` and `Album (Clean)`.
 *
 * The token list is wrapped in `\b(?:…)\b` so legitimate titles like
 * `(Cleaning Up Mix)`, `(Cleaner Cut)`, `(Explicitly Mine)`,
 * `(Editions)` survive — only whole-word matches on the dedupe
 * tokens collapse.
 */
function normaliseAlbumTitle(title: string): string {
  const TOKENS =
    'deluxe|expanded|remastered|anniversary|extended|special|edition|version|bonus|reissue|clean|explicit|edited';
  return title
    .toLowerCase()
    // Parenthesised edition tags: "(Deluxe)", "(Expanded Edition)",
    // "(Remastered 2021)", "(Anniversary Edition)", "(Clean)",
    // "[Explicit]", "(Edited Version)"…
    .replace(new RegExp(`\\s*[([][^()\\[\\]]*\\b(?:${TOKENS})\\b[^()\\[\\]]*[)\\]]\\s*`, 'gi'), ' ')
    // Trailing " - Deluxe" / " — Remastered 2018" suffixes.
    .replace(new RegExp(`\\s*[—–\\-]\\s*\\b(?:${TOKENS})\\b[^,]*$`, 'gi'), ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Two-tier album dedupe.
 *
 *   1. Drop entries with duplicate ids (Tidal can return the same id
 *      across the `ARTIST_ALBUMS` and `ARTIST_COMPILATIONS` modules).
 *   2. Drop entries that look like the same release under a different
 *      id — a deluxe reissue, regional re-release or the like — by
 *      collapsing on `(artistId, normalisedTitle)`. We keep whichever
 *      entry has the newer `releaseDate` (the deluxe / anniversary
 *      cut), falling back to higher track count, falling back to the
 *      first-seen entry.
 *
 * The user reported that some Drake albums repeat 2–4 times on the
 * artist page "identical from the outside" — different ids, same
 * title, same cover. Tier 1 doesn't catch this; tier 2 does.
 */
/**
 * `true` if the album / single is genuinely the requested artist's
 * own release — i.e. they are the *primary* credited artist (first
 * `main: true` entry, exposed as `artistId` on the mapped album).
 *
 * We deliberately do NOT match on "appears anywhere in `artists[]`".
 * Tidal flags every credited artist as `main: true` for joint
 * releases, so a single like PARTYNEXTDOOR x Drake x Cash Cobain's
 * "SOMEBODY LOVES ME PT. 2" would otherwise show up under Drake's
 * EP & Singles page even though Tidal's own artist view treats it
 * as a PARTYNEXTDOOR release. Likewise "Various Artists"
 * compilations carry the requested artist as a contributor on
 * individual tracks but the artist record itself doesn't appear in
 * the album-level `artists[]`.
 *
 * Net effect: only releases where the requested artist is the lead
 * survive — which matches what tidal.com/artist/{id} shows.
 */
function isOwnedByArtist(album: Album, artistId: string): boolean {
  return album.artistId === artistId;
}

function dedupeAlbums(items: Album[]): Album[] {
  const byId = dedupeById(items);
  const byFingerprint = new Map<string, Album>();
  const better = (a: Album, b: Album): Album => {
    const da = a.releaseDate ?? '';
    const db = b.releaseDate ?? '';
    if (da !== db) return da > db ? a : b;
    const ta = a.tracks?.length ?? 0;
    const tb = b.tracks?.length ?? 0;
    if (ta !== tb) return ta > tb ? a : b;
    return b; // keep first-seen
  };
  for (const album of byId) {
    const fp = `${album.artistId ?? ''}::${normaliseAlbumTitle(album.title)}`;
    const existing = byFingerprint.get(fp);
    byFingerprint.set(fp, existing ? better(existing, album) : album);
  }
  return Array.from(byFingerprint.values());
}

/**
 * Response-side prefer-explicit dedupe for albums.
 *
 * When the same `(artistId, normalisedTitle)` is returned twice — once
 * with `explicit=true` and once with `explicit=false` — keep only the
 * explicit variant. This is the layer that handles "Tidal вернул и
 * clean, и explicit edition в одном ответе": even when the request-
 * level `includeExplicit=true` overrides land us both rows, we pick
 * the uncensored one.
 *
 * Order-preserving: walks `items` once, drops the clean entry (or
 * keeps it in place if it's the only variant). Albums lacking an
 * artistId stay unique (we never collapse them).
 */
function preferExplicitAlbums(items: Album[]): Album[] {
  // First pass — record where the explicit twin lives, so we can drop
  // any clean twin we encounter later in the list.
  const explicitTwin = new Map<string, true>();
  for (const a of items) {
    if (a.explicit !== true || !a.artistId) continue;
    explicitTwin.set(`${a.artistId}::${normaliseAlbumTitle(a.title)}`, true);
  }
  // Second pass — drop clean entries that have an explicit twin.
  return items.filter((a) => {
    if (a.explicit === true) return true;
    if (!a.artistId) return true;
    const key = `${a.artistId}::${normaliseAlbumTitle(a.title)}`;
    return !explicitTwin.has(key);
  });
}

/**
 * Response-side prefer-explicit dedupe for tracks.
 *
 * Like {@link preferExplicitAlbums} but groups by
 * `(artistId, normalisedTitle, durationBucket)` — the duration bucket
 * is `Math.round(duration / 5)` so variants within ±2.5s collapse
 * (the audio is identical, only the metadata changed) but obviously
 * different mixes don't accidentally merge.
 *
 * Tracks missing artistId or duration get unique sentinel keys so
 * they can never be collapsed by accident.
 */
function preferExplicitTracks(items: Track[]): Track[] {
  let sentinel = 0;
  const fingerprint = (t: Track): string => {
    if (!t.artistId || !t.duration) return `__unique_${sentinel++}`;
    const bucket = Math.round(t.duration / 5);
    return `${t.artistId}::${normaliseAlbumTitle(t.title)}::${bucket}`;
  };
  const keyByTrack = new Map<Track, string>();
  for (const t of items) keyByTrack.set(t, fingerprint(t));
  const explicitKeys = new Set<string>();
  for (const t of items) {
    if (t.explicit) explicitKeys.add(keyByTrack.get(t) as string);
  }
  return items.filter((t) => {
    if (t.explicit) return true;
    return !explicitKeys.has(keyByTrack.get(t) as string);
  });
}

/**
 * Coerce Tidal's freeform `type` string into our four-bucket enum.
 * Tidal mostly returns `ALBUM` / `EP` / `SINGLE` / `COMPILATION`, but
 * we defensively normalise unknown values to `ALBUM`.
 */
function normaliseReleaseType(raw: string | undefined): Album['releaseType'] {
  switch ((raw ?? '').toUpperCase()) {
    case 'EP':
    case 'EPS':
    case 'EPSANDSINGLES':
      return 'EP';
    case 'SINGLE':
    case 'SINGLES':
      return 'SINGLE';
    case 'COMPILATION':
    case 'COMPILATIONS':
      return 'COMPILATION';
    case 'ALBUM':
    case 'ALBUMS':
      return 'ALBUM';
    default:
      return undefined;
  }
}

function mapAlbum(raw: TidalAlbumRaw, tracks: Track[] = [], releaseTypeOverride?: Album['releaseType']): Album {
  const artists = dedupeArtistRefs(raw.artists);
  const mainArtist = raw.artist ?? raw.artists?.[0];
  // Album-level explicit comes straight from Tidal when present; if
  // upstream omitted the flag (some embedded album refs do) but we
  // already fetched the track list, fall back to "any track explicit"
  // so the UI badge still appears for albums where Tidal forgot to
  // stamp the parent record.
  const explicitFromTracks = tracks.length > 0 ? tracks.some((t) => t.explicit) : false;
  const explicit = raw.explicit === true ? true : explicitFromTracks ? true : raw.explicit === false ? false : undefined;
  return {
    id: String(raw.id),
    source: 'tidal',
    title: raw.title,
    artist: artists?.map(a => a.name).join(', ') || mainArtist?.name || 'Unknown Artist',
    artistId: mainArtist ? String(mainArtist.id) : undefined,
    artists,
    coverUrl: coverUrl(raw.cover),
    coverVideoUrl: videoCoverUrl(raw.videoCover),
    releaseDate: raw.releaseDate,
    releaseType: normaliseReleaseType(raw.type) ?? releaseTypeOverride,
    explicit,
    tracks,
  };
}

function mapArtist(raw: TidalArtistRaw): Artist {
  return {
    id: String(raw.id),
    source: 'tidal',
    name: raw.name,
    imageUrl: artistImageUrl(raw.picture),
  };
}

function mapExplorePlaylist(raw: TidalPlaylistRaw): ExplorePlaylist {
  // Square cover renders better in our grids; fall back to wide image.
  const cover = raw.squareImage ?? raw.image ?? null;
  return {
    id: raw.uuid,
    source: 'tidal',
    title: raw.title,
    description: raw.description ?? undefined,
    coverUrl: coverUrl(cover, 480),
    curator: raw.creator?.name ?? undefined,
    trackCount: raw.numberOfTracks,
    duration: raw.duration,
    explicit: raw.explicit === true ? true : raw.explicit === false ? false : undefined,
  };
}

function mapPageLink(raw: TidalPageLinkRaw): ExplorePageLink | null {
  // The slug is everything after `pages/` — stable across countries.
  const apiPath = raw.apiPath ?? '';
  const slug = apiPath.replace(/^pages\//, '');
  if (!slug) return null;
  return {
    title: raw.title,
    slug,
    icon: raw.icon ?? undefined,
    imageId: raw.imageId ?? undefined,
  };
}

/**
 * Map a single Tidal page module into our normalised shape. Returns
 * null for module types we don't render — keeps the response payload
 * lean and lets the frontend assume every entry is renderable.
 */
function mapPageModule(raw: TidalPageModuleRaw): ExploreModule | null {
  const title = raw.title ?? '';
  const list = raw.pagedList?.items ?? [];
  const total = raw.pagedList?.totalNumberOfItems;
  const rawMorePath = raw.pagedList?.dataApiPath;
  // Only advertise a "show more" path to the client when more items
  // actually exist beyond what the initial page window already
  // returned. Skips the pagination UI for full rows that came back
  // in a single shot.
  const hasMore = total !== undefined && total > list.length;
  const moreApiPath = hasMore ? rawMorePath : undefined;
  const totalItems = total;

  switch (raw.type) {
    case 'PAGE_LINKS':
    case 'PAGE_LINKS_CLOUD': {
      const items = (list as TidalPageLinkRaw[])
        .map(mapPageLink)
        .filter((l): l is ExplorePageLink => l !== null);
      if (items.length === 0) return null;
      return { type: 'pageLinks', title, items, moreApiPath, totalItems };
    }
    case 'TRACK_LIST': {
      const items = (list as TidalTrackRaw[]).map(mapTrack);
      if (items.length === 0) return null;
      return { type: 'tracks', title, items, moreApiPath, totalItems };
    }
    case 'ALBUM_LIST': {
      const items = (list as TidalAlbumRaw[]).map((a) => mapAlbum(a));
      if (items.length === 0) return null;
      return { type: 'albums', title, items, moreApiPath, totalItems };
    }
    case 'ARTIST_LIST': {
      const items = (list as TidalArtistRaw[]).map(mapArtist);
      if (items.length === 0) return null;
      return { type: 'artists', title, items, moreApiPath, totalItems };
    }
    case 'PLAYLIST_LIST':
    case 'MIX_LIST': {
      const items = (list as TidalPlaylistRaw[])
        .filter((p) => p && p.uuid)
        .map(mapExplorePlaylist);
      if (items.length === 0) return null;
      return { type: 'playlists', title, items, moreApiPath, totalItems };
    }
    default:
      // VIDEO_LIST, FEATURED, MIX_HEADER, etc. — nothing to do until
      // we ship video / mix surfaces in the player.
      return null;
  }
}

export class TidalService implements MusicService {
  private api: TidalApi;
  private web: TidalWeb;
  private env: Env;

  constructor(env: Env) {
    const auth = new TidalAuth(env);
    this.api = new TidalApi(auth);
    this.web = new TidalWeb(auth, env);
    this.env = env;
  }

  async search(
    query: string,
    filter: 'all' | 'tracks' | 'albums' | 'artists',
    opts: { limit?: number; offset?: number } = {},
  ): Promise<SearchResult> {
    const typeMap: Record<string, string> = {
      all: 'ARTISTS,ALBUMS,TRACKS',
      tracks: 'TRACKS',
      albums: 'ALBUMS',
      artists: 'ARTISTS',
    };

    const data = await this.api.search(query, typeMap[filter], opts.limit, opts.offset);

    let tracks = this.api.unwrapSearchItems(data.tracks).map(mapTrack);
    let albums = this.api.unwrapSearchItems(data.albums).map((a) => mapAlbum(a));

    // Layer 1: same-response prefer-explicit dedupe — drop the clean
    // twin if Tidal returned both clean and explicit variants in the
    // same search payload.
    tracks = preferExplicitTracks(tracks);
    albums = preferExplicitAlbums(albums);

    // Layer 2: active twin lookup — for tracks/albums that are still
    // flagged as clean (Tidal returned ONLY the clean variant), do
    // an active per-row search to find the explicit twin and
    // substitute. Resolves the user complaint "сам поиск уже сразу
    // с цензурой; если беру id explicit-альбома напрямую — uncensored,
    // айдишники различные". Albums get the same treatment so the
    // user lands on the explicit edition's page from the start
    // instead of a clean tracklist.
    const [tracksSwapped, albumsSwapped] = await Promise.all([
      this.swapInExplicitTwins(tracks),
      this.swapInExplicitAlbumTwins(albums),
    ]);
    tracks = dedupeById(tracksSwapped);
    albums = dedupeAlbums(albumsSwapped);

    return {
      tracks,
      albums,
      artists: this.api.unwrapSearchItems(data.artists).map(mapArtist),
      totalTracks: data.tracks?.totalNumberOfItems,
      totalAlbums: data.albums?.totalNumberOfItems,
      totalArtists: data.artists?.totalNumberOfItems,
    };
  }

  async getTrack(id: string): Promise<Track> {
    const raw = await this.api.getTrack(id);
    return mapTrack(raw);
  }

  async getAlbum(id: string): Promise<Album> {
    // Transparent redirect: if the requested album is the CLEAN
    // edition AND an explicit twin exists, fetch the explicit
    // twin's data instead. The user explicitly asked for this
    // behaviour: "все равно внутри альбома выдает зацензуренные
    // версии … айдишники различные, вариации альбомов есть с
    // цензурой и без". Without this, search/artist-page can swap
    // the album_id at the link level (which we now do via
    // `swapInExplicitAlbumTwins`), but a deep link / saved-library
    // entry to the clean id would still resolve to the clean
    // tracklist. Resolving the redirect here covers the deep-link
    // and library-bookmark paths too.
    //
    // Hot-path overhead: a KV read. Only when the KV is empty do we
    // fall through to a live `/v1/albums/{id}` fetch + (sometimes)
    // a search call — and the resolver itself memoises both the
    // positive and the negative result for 30 days.
    const resolvedId = await this.resolveExplicitAlbumIdRedirect(id).catch(() => id);
    const [raw, tracksRes] = await Promise.all([
      this.api.getAlbum(resolvedId),
      this.api.getAlbumTracks(resolvedId),
    ]);
    if (resolvedId !== id) {
      console.log(`[tidal] getAlbum: redirected clean album ${id} → explicit twin ${resolvedId}`);
    } else if (/\b(clean|edited)\b/i.test(raw.title)) {
      // Couldn't find a twin but the title still looks clean —
      // surface a breadcrumb so operators can spot Tidal-side
      // catalogue gaps in `wrangler tail`.
      console.warn(`[tidal] getAlbum: title suffix looks clean-edition (id=${id} title=${raw.title})`);
    }
    return mapAlbum(raw, tracksRes.items.map(mapTrack));
  }

  async getArtist(id: string): Promise<Artist> {
    const raw = await this.api.getArtist(id);
    return mapArtist(raw);
  }

  async getArtistTopTracks(id: string): Promise<Track[]> {
    const res = await this.api.getArtistTopTracks(id);
    // Tidal's /v1/artists/{id}/toptracks surfaces every track that
    // credits this artist, including features on someone else's
    // singles. Tidal's own artist page shows only tracks where the
    // artist is the primary credit — match that, since the user
    // explicitly wants "только конкретно его треки из официальной
    // карточки тайдал".
    let tracks = res.items.map(mapTrack).filter((t) => t.artistId === id);
    tracks = preferExplicitTracks(tracks);
    tracks = await this.swapInExplicitTwins(tracks);
    return tracks;
  }

  async getArtistAlbums(id: string): Promise<Album[]> {
    const res = await this.api.getArtistAlbums(id);
    let albums = preferExplicitAlbums(res.items.map((a) => mapAlbum(a, [], 'ALBUM')));
    // Active twin swap so the artist's discography never surfaces a
    // clean-edition album when an uncensored twin exists.
    albums = await this.swapInExplicitAlbumTwins(albums);
    return albums;
  }

  /**
   * Combined "Releases" feed for the artist page — Tidal exposes
   * Albums, EPs+Singles and Compilations through three different
   * `filter=` values on the same endpoint, and earlier we were only
   * pulling `ALBUMS`. That meant EPs and compilations were missing,
   * and singles that Tidal also tagged as albums showed up twice.
   *
   * Strategy:
   *   1. Fetch all three filter buckets in parallel; any failing
   *      request just contributes an empty list (route remains live
   *      even if one bucket times out).
   *   2. Tag each release with the bucket we requested it from so the
   *      UI can label / order them. Tidal's own `type` field wins
   *      when present.
   *   3. Dedupe by id, preferring entries from the more "important"
   *      bucket (ALBUM > EP > SINGLE > COMPILATION) — this collapses
   *      the long-standing "single also showing as an album" duplicate.
   *   4. Sort by release date desc so the newest stuff bubbles up.
   */
  /**
   * Albums-and-singles split that exactly mirrors what tidal.com
   * itself shows on the artist page. We reach for `/v1/pages/artist`
   * and pull the editorial modules (`ARTIST_ALBUMS`,
   * `ARTIST_TOP_SINGLES`, `ARTIST_COMPILATIONS`) directly — these are
   * curated/categorised by Tidal, unlike the broad
   * `/v1/artists/{id}/albums?filter=…` buckets which include
   * unrelated cross-bucket items.
   *
   * Returned shape:
   *   - `albums`  = ARTIST_ALBUMS + ARTIST_COMPILATIONS modules
   *                 (deduped by id, sorted release date desc).
   *   - `singles` = ARTIST_TOP_SINGLES module.
   *   - `albumsMore` / `singlesMore` are the opaque `dataApiPath`
   *     values from each `pagedList`, used by the see-all pages to
   *     paginate beyond the initial window. Either may be undefined
   *     if the module already returned everything.
   *
   * Falls back to the old per-bucket `/v1/artists/{id}/albums` calls
   * if the artist page response is missing or empty — keeps small
   * artists with no editorial page from going completely blank.
   */
  async getArtistAlbumsAndSingles(id: string): Promise<{
    albums: Album[];
    singles: Album[];
    albumsMore?: string;
    albumsMoreTotal?: number;
    singlesMore?: string;
    singlesMoreTotal?: number;
  }> {
    interface ModuleBucket {
      items: Album[];
      morePath?: string;
      moreTotal?: number;
    }
    const empty: ModuleBucket = { items: [] };
    const bucketFromModule = (mod: TidalPageModuleRaw | undefined, fallback: Album['releaseType']): ModuleBucket => {
      if (!mod?.pagedList) return empty;
      // Strip any non-album entries (playlists, mixes, page-links
      // — see {@link unwrapPagedAlbum}) before mapping. Tidal's
      // editorial modules occasionally splice these in, and without
      // the filter they'd be cast straight to `TidalAlbumRaw` and
      // rendered as broken album cards.
      const albumItems = (mod.pagedList.items ?? [])
        .map(unwrapPagedAlbum)
        .filter((x): x is TidalAlbumRaw => x !== undefined);
      // Drop compilations where the requested artist is only a
      // featured contributor — Tidal mixes those into
      // ARTIST_ALBUMS / ARTIST_COMPILATIONS pagedLists. See
      // {@link isOwnedByArtist}.
      const items = albumItems
        .map((raw) => mapAlbum(raw, [], fallback))
        .filter((album) => isOwnedByArtist(album, id));
      const total = mod.pagedList.totalNumberOfItems;
      const hasMore = total !== undefined && total > items.length;
      return {
        items,
        morePath: hasMore ? mod.pagedList.dataApiPath : undefined,
        moreTotal: total,
      };
    };

    let albumsMod: ModuleBucket = empty;
    let singlesMod: ModuleBucket = empty;
    let compsMod: ModuleBucket = empty;
    try {
      const page = await this.api.getArtistPage(id);
      const modules = page.rows.flatMap((r) => r.modules);
      albumsMod = bucketFromModule(modules.find((m) => m.type === 'ARTIST_ALBUMS'), 'ALBUM');
      singlesMod = bucketFromModule(modules.find((m) => m.type === 'ARTIST_TOP_SINGLES'), 'SINGLE');
      compsMod = bucketFromModule(modules.find((m) => m.type === 'ARTIST_COMPILATIONS'), 'COMPILATION');
    } catch (err) {
      console.error('[getArtistAlbumsAndSingles] page fetch failed, falling back to v1 buckets', err);
    }

    let albums = dedupeAlbums([...albumsMod.items, ...compsMod.items]);
    let singles = singlesMod.items;
    let albumsMore = albumsMod.morePath ?? compsMod.morePath;
    const albumsMoreTotal = albumsMod.moreTotal !== undefined || compsMod.moreTotal !== undefined
      ? (albumsMod.moreTotal ?? 0) + (compsMod.moreTotal ?? 0)
      : undefined;
    let singlesMore = singlesMod.morePath;
    const singlesMoreTotal = singlesMod.moreTotal;

    // Editorial page returned nothing — fall back to the full v1
    // album-filter merge so small / unfeatured artists still show up.
    if (albums.length === 0 && singles.length === 0) {
      const releases = await this.getArtistReleases(id, 200);
      const a: Album[] = [];
      const s: Album[] = [];
      for (const r of releases) {
        if (r.releaseType === 'SINGLE') s.push(r);
        else a.push(r);
      }
      albums = a;
      singles = s;
      albumsMore = undefined;
      singlesMore = undefined;
    }

    const sortRelDesc = (xs: Album[]) => xs.sort((x, y) => {
      const dx = x.releaseDate ?? '';
      const dy = y.releaseDate ?? '';
      if (dx === dy) return x.title.localeCompare(y.title);
      return dy.localeCompare(dx);
    });

    // Active twin swap on both lists — runs after same-response
    // dedupe so we only spend search round-trips on tracks Tidal
    // gave us as clean-only. KV-memo means a hot artist page
    // mostly hits the cache.
    const [albumsFinal, singlesFinal] = await Promise.all([
      this.swapInExplicitAlbumTwins(preferExplicitAlbums(sortRelDesc(albums))),
      this.swapInExplicitAlbumTwins(preferExplicitAlbums(sortRelDesc(singles))),
    ]);

    return {
      albums: albumsFinal,
      singles: singlesFinal,
      albumsMore,
      albumsMoreTotal,
      singlesMore,
      singlesMoreTotal,
    };
  }

  async getArtistReleases(id: string, limit: number = 50): Promise<Album[]> {
    const [albums, epsSingles, compilations] = await Promise.all([
      this.api.getArtistAlbums(id, limit, 'ALBUMS').catch(() => ({ items: [] as TidalAlbumRaw[] })),
      this.api.getArtistAlbums(id, limit, 'EPSANDSINGLES').catch(() => ({ items: [] as TidalAlbumRaw[] })),
      this.api.getArtistAlbums(id, limit, 'COMPILATIONS').catch(() => ({ items: [] as TidalAlbumRaw[] })),
    ]);

    const merged = new Map<string, Album>();
    const priority: Record<NonNullable<Album['releaseType']>, number> = {
      ALBUM: 4,
      EP: 3,
      SINGLE: 2,
      COMPILATION: 1,
    };
    const ingest = (items: TidalAlbumRaw[], fallback: Album['releaseType']) => {
      for (const raw of items) {
        const mapped = mapAlbum(raw, [], fallback);
        // Drop releases where the requested artist is not the
        // primary credit. Tidal's /v1/artists/{id}/albums does
        // sometimes spill compilations / collaborator-led joints
        // here, especially under filter=COMPILATIONS, and we want
        // this fallback to behave the same way as the editorial
        // page bucket: only the artist's own catalogue.
        if (!isOwnedByArtist(mapped, id)) continue;
        const existing = merged.get(mapped.id);
        if (!existing) {
          merged.set(mapped.id, mapped);
          continue;
        }
        const eRank = existing.releaseType ? priority[existing.releaseType] : 0;
        const nRank = mapped.releaseType ? priority[mapped.releaseType] : 0;
        if (nRank > eRank) merged.set(mapped.id, mapped);
      }
    };
    ingest(albums.items, 'ALBUM');
    // EPs+singles is a single Tidal bucket; rely on raw.type to tell
    // EP and SINGLE apart, with EP as the conservative fallback when
    // upstream omits the field (matches Tidal's web UI behaviour).
    ingest(epsSingles.items, 'EP');
    ingest(compilations.items, 'COMPILATION');

    // Title-level dedupe so reissues / regional duplicates don't
    // produce N copies of the same release. Apply prefer-explicit
    // BEFORE the title-fingerprint dedupe so explicit twins survive
    // the Tier-2 collapser.
    const collapsed = preferExplicitAlbums(Array.from(merged.values()));
    const deduped = dedupeAlbums(collapsed).sort((a, b) => {
      const da = a.releaseDate ?? '';
      const db = b.releaseDate ?? '';
      if (da === db) return a.title.localeCompare(b.title);
      return db.localeCompare(da);
    });
    // Active twin swap — covers the same gap as
    // `getArtistAlbumsAndSingles`. Runs last so dedupe / sort
    // already collapsed the obvious duplicates.
    return this.swapInExplicitAlbumTwins(deduped);
  }

  async getSimilarArtists(id: string): Promise<Artist[]> {
    const res = await this.api.getSimilarArtists(id);
    return res.items.map(mapArtist);
  }

  async getTrackRadio(id: string, limit: number = 25): Promise<Track[]> {
    const res = await this.api.getTrackRadio(id, limit);
    return res.items.map(mapTrack);
  }

  /**
   * Artist radio — Tidal's seeded mix anchored to a specific artist.
   * Surfaces collaborators and similar acts; the radio endpoint is
   * usually richer than `topTracks`, so we expose it as a separate
   * section on the artist page.
   */
  async getArtistRadio(id: string, limit: number = 50): Promise<Track[]> {
    const res = await this.api.getArtistRadio(id, limit);
    return res.items.map(mapTrack);
  }

  async getStreamUrl(trackId: string, quality?: string): Promise<string> {
    return this.web.getStreamUrl(trackId, quality ?? 'HIGH');
  }

  /**
   * Same as `getStreamUrl` but returns the actual quality the ladder
   * resolved to (e.g. caller asks for HI_RES_LOSSLESS, the track only
   * has a clear stream at HIGH, returned `quality` reads `HIGH`).
   *
   * `forDownload=true` switches the underlying TidalWeb cache layer
   * to read-only mode for this resolution so a bulk save (album /
   * playlist download) doesn't burn the daily KV write quota and
   * take the worker offline for every other user. See
   * {@link TidalWeb.setSkipCacheWrites} for the full rationale.
   */
  async resolveStream(trackId: string, quality?: string, forDownload = false) {
    if (forDownload) this.web.setSkipCacheWrites(true);
    try {
      return await this.web.resolveStream(trackId, quality ?? 'HIGH');
    } finally {
      if (forDownload) this.web.setSkipCacheWrites(false);
    }
  }

  async getDownloadUrl(trackId: string): Promise<string> {
    return this.web.getDownloadUrl(trackId, 'LOSSLESS');
  }

  /**
   * Fetch a Tidal page (Explore, Genre, Mood, Decade, …) and return
   * a normalised `ExplorePage` ready for the frontend. Unknown
   * modules are dropped — see `mapPageModule`.
   */
  async getExplorePage(slug: string): Promise<ExplorePage> {
    const raw = await this.api.getPage(slug);
    const modules: ExploreModule[] = [];
    for (const row of raw.rows ?? []) {
      for (const m of row.modules ?? []) {
        const normalised = mapPageModule(m);
        if (normalised) modules.push(normalised);
      }
    }
    // Active twin swap on the initial page payload — same rationale
    // as in `search()` / `getArtistAlbums()`. Tracks and albums on
    // the home/genre/mood pages should never surface a clean
    // edition when an explicit twin exists. Run in parallel across
    // modules; the per-row resolver handles its own KV-memo so
    // repeated visits to the same page are mostly cache hits.
    await Promise.all(
      modules.map(async (mod) => {
        if (mod.type === 'tracks') {
          mod.items = await this.swapInExplicitTwins(preferExplicitTracks(mod.items));
        } else if (mod.type === 'albums') {
          mod.items = await this.swapInExplicitAlbumTwins(preferExplicitAlbums(mod.items));
        }
      }),
    );
    return { title: raw.title, modules };
  }

  /**
   * Pull more albums/singles from the artist page using the opaque
   * `dataApiPath` returned alongside the initial release split. Same
   * mechanism as {@link getExploreList} but typed to albums (the only
   * thing artist page modules return in their pagedLists).
   */
  async getArtistReleasesPage(
    moreApiPath: string,
    opts: { limit?: number; offset?: number } = {},
    artistId?: string,
  ): Promise<{ items: Album[]; totalItems?: number; morePath: string }> {
    const raw = await this.api.getPageData<TidalPagedListRaw<unknown>>(moreApiPath, opts);
    // Same unwrap+filter as the first-page bucket: drop wrapped
    // playlists / mixes that Tidal interleaves into the editorial
    // module's `dataApiPath` response, then drop compilations where
    // the requested artist is only a featured contributor (when an
    // `artistId` is provided), then dedupe so the same release
    // reissued under multiple ids doesn't double-bill.
    const list = (raw.items ?? [])
      .map(unwrapPagedAlbum)
      .filter((x): x is TidalAlbumRaw => x !== undefined);
    const mapped = list.map((a) => mapAlbum(a));
    const owned = artistId ? mapped.filter((a) => isOwnedByArtist(a, artistId)) : mapped;
    // Active twin swap so paginated "see all" pages of an artist's
    // discography surface the explicit edition consistently with the
    // initial bucket.
    const swapped = await this.swapInExplicitAlbumTwins(dedupeAlbums(owned));
    return {
      items: swapped,
      totalItems: raw.totalNumberOfItems,
      morePath: moreApiPath,
    };
  }

  /**
   * Paginate a single module from a Tidal page — the "show all" flow.
   * `moreApiPath` is the opaque `pagedList.dataApiPath` previously
   * returned on an `ExploreModule`. The module type is supplied by
   * the caller so we know how to map the opaque upstream items into
   * our normalised domain shape.
   */
  async getExploreList(
    moreApiPath: string,
    type: ExploreModule['type'],
    opts: { limit?: number; offset?: number } = {},
  ): Promise<{ items: unknown[]; totalItems?: number }> {
    const raw = await this.api.getPageData<TidalPagedListRaw<unknown>>(moreApiPath, opts);
    const list = raw.items ?? [];
    const totalItems = raw.totalNumberOfItems;
    switch (type) {
      case 'tracks': {
        const items = (list as TidalTrackRaw[]).map(mapTrack);
        // Active twin swap to keep parity with search / artist
        // top-tracks — explore "see all" track lists should also
        // never surface the clean edition when an explicit twin
        // exists.
        const swapped = await this.swapInExplicitTwins(preferExplicitTracks(items));
        return { items: swapped, totalItems };
      }
      case 'albums': {
        const items = (list as TidalAlbumRaw[]).map((a) => mapAlbum(a));
        const swapped = await this.swapInExplicitAlbumTwins(preferExplicitAlbums(items));
        return { items: swapped, totalItems };
      }
      case 'artists':
        return { items: (list as TidalArtistRaw[]).map(mapArtist), totalItems };
      case 'playlists':
        return {
          items: (list as TidalPlaylistRaw[])
            .filter((p) => p && p.uuid)
            .map(mapExplorePlaylist),
          totalItems,
        };
      case 'pageLinks':
        return {
          items: (list as TidalPageLinkRaw[])
            .map(mapPageLink)
            .filter((l): l is ExplorePageLink => l !== null),
          totalItems,
        };
    }
  }

  /**
   * Resolve tracks of an editorial Tidal playlist by UUID. Used by
   * linked playlists (sourceKind='tidal') so the saved reference
   * always reflects the upstream contents, and by the explore detail
   * view when a curated playlist is opened directly.
   */
  async getPlaylistTracks(uuid: string, limit = 100): Promise<Track[]> {
    const raw = await this.api.getPlaylistTracks(uuid, limit);
    let tracks = raw.items.map(mapTrack);
    tracks = preferExplicitTracks(tracks);
    // Editorial Tidal playlists are also subject to clean-substitution.
    // Swap each clean track for its explicit twin where one exists,
    // so a Drake / 21 Savage curated playlist plays uncensored.
    tracks = await this.swapInExplicitTwins(tracks);
    return tracks;
  }

  /**
   * Substitute clean tracks for their explicit twins where a twin
   * exists. The output preserves order — only the track payload at
   * each position changes (id, title, explicit flag, artistId, etc.).
   *
   * Strategy:
   *   1. Pick out tracks whose `explicit === false` AND that have
   *      enough metadata (`artistId`, `duration`) to disambiguate.
   *      Tracks that already are explicit, lack a duration, or lack
   *      an artistId stay untouched.
   *   2. For each such track, query Tidal search with the title and
   *      look for an `explicit === true` row with matching artistId
   *      and duration ±2s. KV-memoise the result so a second hit on
   *      the same clean id is free.
   *   3. Where a twin is found, fetch the full explicit track payload
   *      via `getTrack` (so the substitution carries the explicit
   *      cover / album metadata too) and swap in.
   *
   * Failure modes (no twin found, network error, KV miss) all
   * silently fall through and keep the original clean track. Cap
   * concurrency at 4 in-flight lookups to avoid bursting the
   * upstream API and breaking through CF Workers' subrequest limit.
   */
  private async swapInExplicitTwins(items: Track[]): Promise<Track[]> {
    if (items.length === 0) return items;
    const cleanIndices: number[] = [];
    for (let i = 0; i < items.length; i++) {
      const t = items[i];
      if (t.source !== 'tidal') continue;
      if (t.explicit === true) continue;
      if (!t.artistId || !t.duration) continue;
      cleanIndices.push(i);
    }
    if (cleanIndices.length === 0) return items;

    const result = items.slice();
    const CONCURRENCY = 4;
    let cursor = 0;
    const worker = async (): Promise<void> => {
      while (cursor < cleanIndices.length) {
        const myCursor = cursor++;
        const idx = cleanIndices[myCursor];
        const orig = items[idx];
        try {
          const twin = await this.resolveExplicitTwin(orig);
          if (twin) result[idx] = twin;
        } catch {
          // Silent fallthrough — keep original on any error.
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, cleanIndices.length) }, worker));
    return result;
  }

  /**
   * Look up the explicit twin of a clean track. Returns the explicit
   * Track on hit, null when no twin exists or the clean track is
   * already the only variant.
   *
   * KV cache: `tidal-explicit-twin:<cleanId>` →
   *   - `<explicitId>` for a known twin
   *   - `__none__` for "checked, no twin exists" (negative cache)
   * 30-day TTL for both. Stops us re-querying Tidal for every cold
   * search hit.
   */
  private async resolveExplicitTwin(clean: Track): Promise<Track | null> {    const cacheKey = `tidal-explicit-twin:${clean.id}`;
    try {
      const cached = await kvGetText(this.env.SESSIONS, cacheKey);
      if (cached === '__none__') return null;
      if (cached) {
        // A previously-resolved explicit id. Re-fetch the full
        // payload so the substitution carries fresh cover / album
        // metadata (the saved id alone is stable, but its
        // catalogue row may have been updated upstream).
        const raw = await this.api.getTrack(cached).catch(() => null);
        if (raw && raw.explicit) return mapTrack(raw);
        // Stale negative — fall through and re-resolve.
      }
    } catch {
      // KV transient failure — proceed with the live lookup.
    }

    // Query Tidal search for the title + primary artist. Tidal's
    // search ranks by relevance, so the explicit twin (when it
    // exists) is almost always in the first 10 hits.
    const artistName = clean.artists?.[0]?.name ?? clean.artist ?? '';
    const queryParts = [clean.title, artistName].filter((s) => s && s.length > 0);
    const query = queryParts.join(' ').slice(0, 200);
    if (!query) return null;

    // The api.search return type is internal (TidalSearchResponse);
    // declare a structural local that's narrow enough for
    // `unwrapSearchItems<TidalTrackRaw>` to typecheck without
    // re-exporting the upstream type.
    let res: Awaited<ReturnType<TidalApi['search']>>;
    try {
      res = await this.api.search(query, 'TRACKS', 20, 0);
    } catch {
      return null;
    }

    const candidates = this.api.unwrapSearchItems(res.tracks).map(mapTrack);
    const targetTitle = normaliseAlbumTitle(clean.title);
    let twin: Track | null = null;
    for (const cand of candidates) {
      if (cand.id === clean.id) continue;
      if (cand.explicit !== true) continue;
      if (cand.artistId !== clean.artistId) continue;
      if (!cand.duration) continue;
      if (Math.abs(cand.duration - clean.duration) > 2) continue;
      if (normaliseAlbumTitle(cand.title) !== targetTitle) continue;
      twin = cand;
      break;
    }

    // Persist outcome (positive or negative) so subsequent searches
    // don't re-query Tidal for the same clean id.
    const TTL_S = 30 * 24 * 60 * 60;
    try {
      await kvPutText(this.env.SESSIONS, cacheKey, twin ? twin.id : '__none__', TTL_S);
    } catch {
      // best-effort
    }
    return twin;
  }

  /**
   * Album-level counterpart to {@link swapInExplicitTwins}. For each
   * clean album in the list (where Tidal returned ONLY the clean
   * variant — not just both in the same response, which the
   * `preferExplicitAlbums` same-response dedupe already handles),
   * issue an active album search for the explicit twin and substitute
   * the album payload. Order-preserving, concurrency-capped, KV-memo.
   *
   * Why this matters: the user reported "сам поиск уже сразу с
   * цензурой; если беру id explicit-альбома напрямую — uncensored.
   * айдишники различные". Without this layer, search returns the
   * clean album_id, the user clicks through, getAlbum(cleanId)
   * faithfully returns the clean tracklist (because by-id retrieval
   * IS the user contract). Substituting the album_id at the search
   * layer means the user lands on the explicit edition's page from
   * the start.
   */
  private async swapInExplicitAlbumTwins(items: Album[]): Promise<Album[]> {
    if (items.length === 0) return items;
    const cleanIndices: number[] = [];
    for (let i = 0; i < items.length; i++) {
      const a = items[i];
      if (a.source !== 'tidal') continue;
      // Same-response dedupe already collapsed clean+explicit twins
      // returned in one payload — anything still flagged explicit
      // here stays untouched.
      if (a.explicit === true) continue;
      // Need an artistId to disambiguate the search hit. Without it
      // we'd risk swapping in a same-titled album from a different
      // artist (e.g. self-titled debuts).
      if (!a.artistId) continue;
      cleanIndices.push(i);
    }
    if (cleanIndices.length === 0) return items;

    const result = items.slice();
    const CONCURRENCY = 4;
    let cursor = 0;
    const worker = async (): Promise<void> => {
      while (cursor < cleanIndices.length) {
        const myCursor = cursor++;
        const idx = cleanIndices[myCursor];
        const orig = items[idx];
        try {
          const twin = await this.resolveExplicitAlbumTwin(orig);
          if (twin) result[idx] = twin;
        } catch {
          // Silent fallthrough — keep original on any error.
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, cleanIndices.length) }, worker));
    return result;
  }

  /**
   * Look up the explicit twin of a clean album. Returns the
   * `Album` payload on hit (id, title, cover, releaseType, …),
   * null when no twin exists.
   *
   * KV cache: `tidal-explicit-album-twin:<cleanId>` →
   *   - `<explicitId>` for a known twin
   *   - `__none__` for "checked, no twin exists" (negative cache)
   * 30-day TTL.
   *
   * Match criteria: same primary artistId AND
   * `normaliseAlbumTitle()` equality (which strips Clean / Explicit /
   * Edited / Deluxe / Anniversary suffixes) AND `explicit === true`.
   * Track count match is a strong tiebreaker but not required —
   * occasionally Tidal lists the explicit edition with one extra
   * skit / interlude.
   */
  private async resolveExplicitAlbumTwin(clean: Album): Promise<Album | null> {
    const cacheKey = `tidal-explicit-album-twin:${clean.id}`;
    try {
      const cached = await kvGetText(this.env.SESSIONS, cacheKey);
      if (cached === '__none__') return null;
      if (cached) {
        const raw = await this.api.getAlbum(cached).catch(() => null);
        if (raw && raw.explicit) {
          // Hydrate tracks too — most callers expect them populated.
          const tracksRes = await this.api.getAlbumTracks(cached).catch(() => null);
          const tracks = tracksRes ? tracksRes.items.map(mapTrack) : [];
          return mapAlbum(raw, tracks);
        }
        // Stale negative — fall through and re-resolve.
      }
    } catch {
      // KV transient failure — proceed with the live lookup.
    }

    // Search Tidal for the title + primary artist. The artistId is
    // mandatory (we already gated the caller on it).
    const artistName = clean.artists?.[0]?.name ?? clean.artist ?? '';
    const queryParts = [clean.title, artistName].filter((s) => s && s.length > 0);
    const query = queryParts.join(' ').slice(0, 200);
    if (!query) return null;

    let res: Awaited<ReturnType<TidalApi['search']>>;
    try {
      res = await this.api.search(query, 'ALBUMS', 20, 0);
    } catch {
      return null;
    }

    const candidates = this.api.unwrapSearchItems(res.albums).map((a) => mapAlbum(a));
    const targetTitle = normaliseAlbumTitle(clean.title);
    let twin: Album | null = null;
    for (const cand of candidates) {
      if (cand.id === clean.id) continue;
      if (cand.explicit !== true) continue;
      if (cand.artistId !== clean.artistId) continue;
      if (normaliseAlbumTitle(cand.title) !== targetTitle) continue;
      twin = cand;
      break;
    }

    // Persist outcome so subsequent search/album-list traversals
    // don't re-query Tidal for the same clean id.
    const TTL_S = 30 * 24 * 60 * 60;
    try {
      await kvPutText(this.env.SESSIONS, cacheKey, twin ? twin.id : '__none__', TTL_S);
    } catch {
      // best-effort
    }
    if (!twin) return null;

    // Hydrate tracks for the twin so callers (most importantly
    // `getAlbum`) get a fully-populated album payload back instead
    // of a metadata-only one.
    try {
      const tracksRes = await this.api.getAlbumTracks(twin.id);
      const raw = await this.api.getAlbum(twin.id).catch(() => null);
      if (raw) {
        return mapAlbum(raw, tracksRes.items.map(mapTrack));
      }
    } catch {
      // Track hydration is best-effort — the metadata-only twin is
      // still useful at the search-list level.
    }
    return twin;
  }

  /**
   * Resolve a clean album id to its explicit twin id (or the original
   * id when no twin exists). Reads the KV memo first so a hot path
   * doesn't take the network round-trip.
   *
   * Used by `getAlbum` to redirect a clean-album navigation to the
   * uncensored edition transparently — see the comment in
   * `getAlbum` for the user-contract rationale.
   */
  private async resolveExplicitAlbumIdRedirect(id: string): Promise<string> {
    try {
      const cached = await kvGetText(this.env.SESSIONS, `tidal-explicit-album-twin:${id}`);
      if (cached && cached !== '__none__') return cached;
      if (cached === '__none__') return id;
    } catch {
      // KV miss — fall through to a live resolution.
    }

    // Live resolution: fetch the album metadata (cheap), see if it's
    // already explicit (no swap needed), otherwise let the album
    // twin-resolver run its own lookup + KV-memo.
    let raw: TidalAlbumRaw;
    try {
      raw = await this.api.getAlbum(id);
    } catch {
      return id;
    }
    if (raw.explicit === true) {
      try {
        await kvPutText(this.env.SESSIONS, `tidal-explicit-album-twin:${id}`, '__none__', 30 * 24 * 60 * 60);
      } catch {
        // best-effort
      }
      return id;
    }
    const cleanAlbum = mapAlbum(raw);
    if (!cleanAlbum.artistId) return id;
    const twin = await this.resolveExplicitAlbumTwin(cleanAlbum);
    return twin ? twin.id : id;
  }
}
