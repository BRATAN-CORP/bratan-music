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

const IMG_BASE = 'https://resources.tidal.com/images';

function coverUrl(coverId: string | null | undefined, size: number = 640): string | undefined {
  if (!coverId) return undefined;
  return `${IMG_BASE}/${coverId.replace(/-/g, '/')}/${size}x${size}.jpg`;
}

const VIDEO_BASE = 'https://resources.tidal.com/videos';

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
  return `${IMG_BASE}/${pictureId.replace(/-/g, '/')}/${size}x${size}.jpg`;
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
 * Used by the second-tier album dedupe (see {@link dedupeAlbums}).
 */
function normaliseAlbumTitle(title: string): string {
  return title
    .toLowerCase()
    // Parenthesised edition tags: "(Deluxe)", "(Expanded Edition)",
    // "(Remastered 2021)", "(Anniversary Edition)", …
    .replace(/\s*[([][^()\[\]]*\b(?:deluxe|expanded|remastered|anniversary|extended|special|edition|version|bonus|reissue)[^()\[\]]*[)\]]\s*/gi, ' ')
    // Trailing " - Deluxe" / " — Remastered 2018" suffixes.
    .replace(/\s*[—–\-]\s*(?:deluxe|expanded|remastered|anniversary|extended|special|edition|version|bonus|reissue)\b[^,]*$/gi, ' ')
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

  constructor(env: Env) {
    const auth = new TidalAuth(env);
    this.api = new TidalApi(auth);
    this.web = new TidalWeb(auth);
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

    return {
      tracks: this.api.unwrapSearchItems(data.tracks).map(mapTrack),
      albums: this.api.unwrapSearchItems(data.albums).map(a => mapAlbum(a)),
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
    const [raw, tracksRes] = await Promise.all([
      this.api.getAlbum(id),
      this.api.getAlbumTracks(id),
    ]);
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
    return res.items.map(mapTrack).filter((t) => t.artistId === id);
  }

  async getArtistAlbums(id: string): Promise<Album[]> {
    const res = await this.api.getArtistAlbums(id);
    return res.items.map(a => mapAlbum(a, [], 'ALBUM'));
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

    return {
      albums: sortRelDesc(albums),
      singles: sortRelDesc(singles),
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

    return Array.from(merged.values()).sort((a, b) => {
      const da = a.releaseDate ?? '';
      const db = b.releaseDate ?? '';
      if (da === db) return a.title.localeCompare(b.title);
      return db.localeCompare(da);
    });
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
    return {
      items: dedupeAlbums(owned),
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
      case 'tracks':
        return { items: (list as TidalTrackRaw[]).map(mapTrack), totalItems };
      case 'albums':
        return { items: (list as TidalAlbumRaw[]).map((a) => mapAlbum(a)), totalItems };
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
    return raw.items.map(mapTrack);
  }
}
