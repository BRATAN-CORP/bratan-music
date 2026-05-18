import { TidalAuth } from './TidalAuth';

const API_BASE = 'https://api.tidal.com';

interface TidalSearchResponse {
  artists?: TidalSearchBucket<TidalArtistRaw>;
  albums?: TidalSearchBucket<TidalAlbumRaw>;
  tracks?: TidalSearchBucket<TidalTrackRaw>;
}

export interface TidalTrackRaw {
  id: number;
  title: string;
  duration: number;
  version?: string | null;
  explicit?: boolean;
  popularity?: number;
  trackNumber?: number;
  volumeNumber?: number;
  streamReady?: boolean;
  allowStreaming?: boolean;
  audioQuality?: string;
  audioModes?: string[];
  artist?: { id: number; name: string };
  artists?: { id: number; name: string; type?: string }[];
  album?: { id: number; title: string; cover: string | null; videoCover?: string | null };
}

export interface TidalAlbumRaw {
  id: number;
  title: string;
  duration?: number;
  numberOfTracks?: number;
  releaseDate?: string;
  cover?: string | null;
  /** UUID of an animated mp4 cover (only some albums). */
  videoCover?: string | null;
  artist?: { id: number; name: string };
  artists?: { id: number; name: string; type?: string }[];
  audioQuality?: string;
  /**
   * Album-level Explicit flag. Tidal stamps this on the album record
   * whenever ANY track on it is explicit — used to render the `E`
   * badge on cards / hero without scanning the whole track list.
   */
  explicit?: boolean;
  /**
   * Release classification — Tidal returns one of `ALBUM`, `EP`,
   * `SINGLE`, `COMPILATION`. Optional because some endpoints elide it
   * (e.g. embedded album refs inside tracks).
   */
  type?: string;
}

export interface TidalArtistRaw {
  id: number;
  name: string;
  picture?: string | null;
  popularity?: number;
}

export interface TidalLyricsRaw {
  trackId: number;
  lyricsProvider?: string;
  providerCommontrackId?: string;
  providerLyricsId?: string;
  /** Plain unsynced lyrics. */
  lyrics?: string | null;
  /** LRC-style synced lyrics ("[mm:ss.xx] line"). */
  subtitles?: string | null;
  isRightToLeft?: boolean;
}

type WrappedSearchItem<T> = T | { item?: T; value?: T };

interface TidalSearchBucket<T> {
  items?: WrappedSearchItem<T>[];
  totalNumberOfItems?: number;
}

export interface TidalPlaylistRaw {
  uuid: string;
  title: string;
  description?: string | null;
  type?: string;
  url?: string;
  /** Wide cover. */
  image?: string | null;
  /** Square cover (preferred for grids). */
  squareImage?: string | null;
  duration?: number;
  numberOfTracks?: number;
  numberOfVideos?: number;
  creator?: { id?: number; name?: string } | null;
  promotedArtists?: { id: number; name: string }[];
  /**
   * Playlist-level Explicit flag. Tidal stamps this on any editorial
   * playlist whose track set contains explicit material — used to
   * render the `E` badge next to the title on cards / hero without
   * cracking open the track listing.
   */
  explicit?: boolean;
}

export interface TidalPageLinkRaw {
  title: string;
  apiPath?: string;
  icon?: string;
  imageId?: string;
}

export interface TidalPagedListRaw<T> {
  dataApiPath?: string;
  limit?: number;
  offset?: number;
  totalNumberOfItems?: number;
  items: T[];
}

export interface TidalPageModuleRaw {
  id: string;
  type: string;
  title?: string;
  description?: string;
  width?: number;
  pagedList?: TidalPagedListRaw<unknown>;
  /** PAGE_LINKS / PAGE_LINKS_CLOUD */
  showMore?: { title?: string; apiPath?: string };
}

export interface TidalPageRaw {
  selfLink?: string | null;
  id: string;
  title: string;
  rows: { modules: TidalPageModuleRaw[] }[];
}

export class TidalApi {
  constructor(private auth: TidalAuth) {}

  /**
   * Common query parameters Tidal Web threads through every API call.
   *
   * `includeExplicit=true` + `explicitContent=true` are the request-
   * level overrides documented in leaked Web client builds: when the
   * pool account's profile-level "Explicit Content" filter is ON
   * (which we cannot reliably toggle via the public API — see
   * TidalExplicitFilter.ts), some search / catalogue endpoints honour
   * these params and return the uncensored variant. This is only one
   * of three layers — TidalService also runs a response-side
   * preferExplicit dedupe and an active explicit-twin lookup. We
   * deliberately do NOT thread `useEditedLyrics=false` here: it's
   * a lyrics-specific hint, threading it through search/album
   * endpoints occasionally trips strict per-endpoint validators
   * (Tidal documents non-lyrics endpoints as ignore-unknown-params,
   * but unknown-param tolerance has regressed in past releases).
   */
  private async commonParams(extra: Record<string, string> = {}): Promise<URLSearchParams> {
    const cc = await this.auth.getCountryCode();
    const params = new URLSearchParams({
      countryCode: cc,
      locale: this.auth.getLocale(),
      deviceType: 'BROWSER',
      includeExplicit: 'true',
      explicitContent: 'true',
      ...extra,
    });
    return params;
  }

  async search(query: string, types: string = 'ARTISTS,ALBUMS,TRACKS', limit: number = 25, offset: number = 0): Promise<TidalSearchResponse> {
    const params = await this.commonParams({
      query,
      limit: String(limit),
      offset: String(offset),
      types,
      includeContributors: 'true',
      includeUserPlaylists: 'false',
      supportsUserData: 'true',
    });
    return this.get<TidalSearchResponse>(`/v1/search?${params}`);
  }

  async getTrack(trackId: string): Promise<TidalTrackRaw> {
    const params = await this.commonParams();
    return this.get<TidalTrackRaw>(`/v1/tracks/${trackId}?${params}`);
  }

  async getAlbum(albumId: string): Promise<TidalAlbumRaw> {
    const params = await this.commonParams();
    return this.get<TidalAlbumRaw>(`/v1/albums/${albumId}?${params}`);
  }

  async getAlbumTracks(albumId: string, limit: number = 100): Promise<{ items: TidalTrackRaw[] }> {
    const params = await this.commonParams({ limit: String(limit), offset: '0' });
    return this.get<{ items: TidalTrackRaw[] }>(`/v1/albums/${albumId}/tracks?${params}`);
  }

  async getArtist(artistId: string): Promise<TidalArtistRaw> {
    const params = await this.commonParams();
    return this.get<TidalArtistRaw>(`/v1/artists/${artistId}?${params}`);
  }

  async getArtistTopTracks(artistId: string, limit: number = 10): Promise<{ items: TidalTrackRaw[] }> {
    const params = await this.commonParams({ limit: String(limit), offset: '0' });
    return this.get<{ items: TidalTrackRaw[] }>(`/v1/artists/${artistId}/toptracks?${params}`);
  }

  async getArtistAlbums(artistId: string, limit: number = 50, filter: string = 'ALBUMS'): Promise<{ items: TidalAlbumRaw[] }> {
    const params = await this.commonParams({ limit: String(limit), offset: '0', filter });
    return this.get<{ items: TidalAlbumRaw[] }>(`/v1/artists/${artistId}/albums?${params}`);
  }

  async getSimilarArtists(artistId: string, limit: number = 10): Promise<{ items: TidalArtistRaw[] }> {
    const params = await this.commonParams({ limit: String(limit) });
    return this.get<{ items: TidalArtistRaw[] }>(`/v1/artists/${artistId}/similar?${params}`);
  }

  async getTrackRadio(trackId: string, limit: number = 25): Promise<{ items: TidalTrackRaw[] }> {
    const params = await this.commonParams({ limit: String(limit), offset: '0' });
    return this.get<{ items: TidalTrackRaw[] }>(`/v1/tracks/${trackId}/radio?${params}`);
  }

  /**
   * "Artist radio" — Tidal's seeded mix that starts from a given
   * artist and fans out into similar / collaborator territory.
   *
   * Tidal exposes two different shapes here:
   *   - `/v1/artists/{id}/radio` returns `{ items: TidalTrackRaw[] }`
   *     directly — same envelope as `/tracks/{id}/radio`.
   *   - `/v1/artists/{id}/mix` returns a Mix descriptor with a UUID
   *     that then has to be resolved against `/v1/mixes/{id}/items`.
   *
   * Web-tidal hits the mix flow; the radio flow is fewer round-trips
   * and matches our existing track-radio code path. We try `/radio`
   * first and fall back to the mix flow if upstream returns 404 — that
   * way the call works regardless of which endpoint a given Tidal
   * region keeps on. The fallback uses two sequential requests, but
   * only when needed.
   */
  async getArtistRadio(artistId: string, limit: number = 50): Promise<{ items: TidalTrackRaw[] }> {
    const params = await this.commonParams({ limit: String(limit), offset: '0' });
    try {
      return await this.get<{ items: TidalTrackRaw[] }>(
        `/v1/artists/${artistId}/radio?${params}`,
      );
    } catch (err) {
      // `/radio` is region-gated; fall back to the mix flow only on
      // not-found / bad-request, mirroring the lyrics fallback above.
      const msg = err instanceof Error ? err.message : '';
      if (!/\b404\b/.test(msg) && !/\b400\b/.test(msg)) throw err;
      const mixParams = await this.commonParams();
      const mix = await this.get<{ id: string }>(
        `/v1/artists/${artistId}/mix?${mixParams}`,
      );
      const itemsParams = await this.commonParams({ limit: String(limit), offset: '0' });
      const res = await this.get<{ items: { item?: TidalTrackRaw; type?: string }[] }>(
        `/v1/mixes/${mix.id}/items?${itemsParams}`,
      );
      const items = res.items
        .filter((row) => (row.type ?? 'track') === 'track' && row.item)
        .map((row) => row.item as TidalTrackRaw);
      return { items };
    }
  }

  /**
   * Fetch tracks of an editorial Tidal playlist by UUID. The
   * upstream endpoint paginates; for now we ask for a single window
   * up to `limit` (Tidal allows up to 100 per request).
   */
  async getPlaylistTracks(uuid: string, limit: number = 100): Promise<{ items: TidalTrackRaw[] }> {
    const params = await this.commonParams({ limit: String(limit), offset: '0' });
    return this.get<{ items: TidalTrackRaw[] }>(`/v1/playlists/${uuid}/tracks?${params}`);
  }

  async getTrackLyrics(trackId: string): Promise<TidalLyricsRaw | null> {
    const cc = await this.auth.getCountryCode();
    const locale = this.auth.getLocale();

    // Tidal serves the per-account "Edited Lyrics" variant whenever the
    // pool account's Explicit Content filter is ON — for our use case
    // that's exactly what we DON'T want. The v1 endpoint accepts several
    // undocumented hint parameters that the leaked Tidal Web client
    // sends when the filter is off: `includeExplicit`, `explicitContent`,
    // `explicit`. We chain them with `useEditedLyrics=false` to also
    // suppress the censored-variant swap on the lyrics path. The
    // `Edited` provider id has historically been served as a separate
    // record; passing a non-edited preference shortcuts to the
    // original. Each attempt is best-effort — first one that returns
    // a non-null payload with non-empty `lyrics` wins.
    const variants: string[] = [
      `/v1/tracks/${trackId}/lyrics?countryCode=${cc}&locale=${locale}&deviceType=BROWSER&includeExplicit=true&explicitContent=true&useEditedLyrics=false`,
      `/v2/tracks/${trackId}/lyrics?countryCode=${cc}&locale=${locale}&deviceType=BROWSER&includeExplicit=true`,
      `/v1/tracks/${trackId}/lyrics?countryCode=${cc}&locale=${locale}&deviceType=BROWSER`,
    ];

    let lastErr: Error | null = null;
    for (const path of variants) {
      try {
        const raw = await this.get<TidalLyricsRaw>(path);
        if (raw && (raw.lyrics || raw.subtitles)) return raw;
        // Empty payload (no lyrics field) — try next variant.
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // 404 on the variant just means "this shape isn't supported";
        // keep walking the fallback chain. Any other error gets
        // captured and surfaced if everything fails.
        if (!/\b404\b/.test(msg)) lastErr = err instanceof Error ? err : new Error(msg);
      }
    }

    if (lastErr) {
      // None of the variants returned a payload AND at least one
      // failed with a non-404 error — preserve that for the caller.
      if (/\b404\b/.test(lastErr.message)) return null;
      throw lastErr;
    }
    return null;
  }

  /**
   * Fetch a Tidal "page" — what their web/desktop apps render for
   * Explore, Genre, Mood, Decade, etc. screens. The response is a
   * structured tree of "modules" (PLAYLIST_LIST, TRACK_LIST,
   * PAGE_LINKS_CLOUD, …). Caller is responsible for normalising
   * each module type into our Track/Album/Artist/Playlist shapes.
   */
  async getPage<T = TidalPageRaw>(slug: string): Promise<T> {
    const params = await this.commonParams();
    return this.get<T>(`/v1/pages/${slug}?${params}`);
  }

  /**
   * Fetch the per-artist page (`/v1/pages/artist?artistId=X`). This is
   * the exact same payload Tidal's web client renders the artist
   * screen from — including modules `ARTIST_TOP_TRACKS`,
   * `ARTIST_ALBUMS`, `ARTIST_TOP_SINGLES` (EPs + singles),
   * `ARTIST_COMPILATIONS`, `ARTIST_PLAYLIST`, and a few promo blocks.
   * Using this gives us the editorial categorisation that matches
   * Tidal.com (rather than the broader v1 album-filter buckets, which
   * mix singles into ALBUMS).
   */
  async getArtistPage(artistId: string): Promise<TidalPageRaw> {
    const params = await this.commonParams({ artistId });
    return this.get<TidalPageRaw>(`/v1/pages/artist?${params}`);
  }

  /**
   * Some modules paginate via a `dataApiPath` like `pages/data/<uuid>`
   * — useful when the user clicks "View as list". The `limit`/`offset`
   * pair lets callers page through the full list; Tidal accepts up
   * to 50 items per window on these endpoints.
   */
  async getPageData<T = TidalPagedListRaw<unknown>>(
    dataApiPath: string,
    opts: { limit?: number; offset?: number } = {},
  ): Promise<T> {
    const extra: Record<string, string> = {};
    if (opts.limit !== undefined) extra.limit = String(opts.limit);
    if (opts.offset !== undefined) extra.offset = String(opts.offset);
    const params = await this.commonParams(extra);
    const cleaned = dataApiPath.startsWith('/') ? dataApiPath : `/${dataApiPath}`;
    return this.get<T>(`/v1${cleaned}?${params}`);
  }

  unwrapSearchItems<T>(bucket?: TidalSearchBucket<T>): T[] {
    return (bucket?.items ?? [])
      .map((entry) => {
        if (typeof entry === 'object' && entry !== null && 'item' in entry) return entry.item;
        if (typeof entry === 'object' && entry !== null && 'value' in entry) return entry.value;
        return entry;
      })
      .filter((entry): entry is T => entry !== undefined);
  }

  private async get<T>(path: string): Promise<T> {
    const doFetch = async (token: string) => fetch(`${API_BASE}${path}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        // Posing as the Tidal Web client (`listen.tidal.com`) — some
        // catalogue endpoints honour the request-level
        // `includeExplicit` / `explicitContent` overrides only when
        // the request looks like it originated from Tidal Web. The
        // mobile UA we historically sent caused these endpoints to
        // ignore the overrides and fall back to the per-account
        // "Explicit Content" filter, which surfaced as clean variants
        // in search / artist top-tracks even though the same account
        // returns explicit on tidal.com itself.
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
          '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
        Origin: 'https://listen.tidal.com',
        Referer: 'https://listen.tidal.com/',
        'x-tidal-client-version': this.auth.getClientVersion(),
      },
    });

    let token = await this.auth.getAccessToken();
    let res = await doFetch(token);
    if (res.status === 401) {
      token = await this.auth.getAccessToken({ force: true });
      res = await doFetch(token);
    }

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Tidal API ${res.status}: ${text.slice(0, 300)}`);
    }

    return res.json<T>();
  }
}
