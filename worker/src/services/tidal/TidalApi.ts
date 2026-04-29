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

  async search(query: string, types: string = 'ARTISTS,ALBUMS,TRACKS', limit: number = 25, offset: number = 0): Promise<TidalSearchResponse> {
    const cc = await this.auth.getCountryCode();
    const params = new URLSearchParams({
      query,
      limit: String(limit),
      offset: String(offset),
      types,
      includeContributors: 'true',
      includeUserPlaylists: 'false',
      supportsUserData: 'true',
      countryCode: cc,
      locale: this.auth.getLocale(),
      deviceType: 'BROWSER',
    });
    return this.get<TidalSearchResponse>(`/v1/search?${params}`);
  }

  async getTrack(trackId: string): Promise<TidalTrackRaw> {
    const cc = await this.auth.getCountryCode();
    return this.get<TidalTrackRaw>(`/v1/tracks/${trackId}?countryCode=${cc}`);
  }

  async getAlbum(albumId: string): Promise<TidalAlbumRaw> {
    const cc = await this.auth.getCountryCode();
    return this.get<TidalAlbumRaw>(`/v1/albums/${albumId}?countryCode=${cc}`);
  }

  async getAlbumTracks(albumId: string, limit: number = 100): Promise<{ items: TidalTrackRaw[] }> {
    const cc = await this.auth.getCountryCode();
    return this.get<{ items: TidalTrackRaw[] }>(`/v1/albums/${albumId}/tracks?limit=${limit}&offset=0&countryCode=${cc}`);
  }

  async getArtist(artistId: string): Promise<TidalArtistRaw> {
    const cc = await this.auth.getCountryCode();
    return this.get<TidalArtistRaw>(`/v1/artists/${artistId}?countryCode=${cc}`);
  }

  async getArtistTopTracks(artistId: string, limit: number = 10): Promise<{ items: TidalTrackRaw[] }> {
    const cc = await this.auth.getCountryCode();
    return this.get<{ items: TidalTrackRaw[] }>(`/v1/artists/${artistId}/toptracks?limit=${limit}&offset=0&countryCode=${cc}`);
  }

  async getArtistAlbums(artistId: string, limit: number = 50, filter: string = 'ALBUMS'): Promise<{ items: TidalAlbumRaw[] }> {
    const cc = await this.auth.getCountryCode();
    return this.get<{ items: TidalAlbumRaw[] }>(`/v1/artists/${artistId}/albums?limit=${limit}&offset=0&filter=${filter}&countryCode=${cc}`);
  }

  async getSimilarArtists(artistId: string, limit: number = 10): Promise<{ items: TidalArtistRaw[] }> {
    const cc = await this.auth.getCountryCode();
    return this.get<{ items: TidalArtistRaw[] }>(`/v1/artists/${artistId}/similar?limit=${limit}&countryCode=${cc}`);
  }

  async getTrackRadio(trackId: string, limit: number = 25): Promise<{ items: TidalTrackRaw[] }> {
    const cc = await this.auth.getCountryCode();
    return this.get<{ items: TidalTrackRaw[] }>(`/v1/tracks/${trackId}/radio?limit=${limit}&offset=0&countryCode=${cc}`);
  }

  /**
   * Fetch tracks of an editorial Tidal playlist by UUID. The
   * upstream endpoint paginates; for now we ask for a single window
   * up to `limit` (Tidal allows up to 100 per request).
   */
  async getPlaylistTracks(uuid: string, limit: number = 100): Promise<{ items: TidalTrackRaw[] }> {
    const cc = await this.auth.getCountryCode();
    const params = new URLSearchParams({
      countryCode: cc,
      limit: String(limit),
      offset: '0',
    });
    return this.get<{ items: TidalTrackRaw[] }>(`/v1/playlists/${uuid}/tracks?${params}`);
  }

  async getTrackLyrics(trackId: string): Promise<TidalLyricsRaw | null> {
    const cc = await this.auth.getCountryCode();
    try {
      return await this.get<TidalLyricsRaw>(
        `/v1/tracks/${trackId}/lyrics?countryCode=${cc}&locale=${this.auth.getLocale()}&deviceType=BROWSER`,
      );
    } catch (err) {
      // Tidal returns 404 for tracks that have no lyrics — surface that as
      // null so callers don't have to special-case the error message.
      if (err instanceof Error && /\b404\b/.test(err.message)) return null;
      throw err;
    }
  }

  /**
   * Fetch a Tidal "page" — what their web/desktop apps render for
   * Explore, Genre, Mood, Decade, etc. screens. The response is a
   * structured tree of "modules" (PLAYLIST_LIST, TRACK_LIST,
   * PAGE_LINKS_CLOUD, …). Caller is responsible for normalising
   * each module type into our Track/Album/Artist/Playlist shapes.
   */
  async getPage<T = TidalPageRaw>(slug: string): Promise<T> {
    const cc = await this.auth.getCountryCode();
    const params = new URLSearchParams({
      countryCode: cc,
      locale: this.auth.getLocale(),
      deviceType: 'BROWSER',
    });
    return this.get<T>(`/v1/pages/${slug}?${params}`);
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
    const cc = await this.auth.getCountryCode();
    const params = new URLSearchParams({
      countryCode: cc,
      locale: this.auth.getLocale(),
      deviceType: 'BROWSER',
    });
    if (opts.limit !== undefined) params.set('limit', String(opts.limit));
    if (opts.offset !== undefined) params.set('offset', String(opts.offset));
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
        'User-Agent': 'TIDAL/2026.4.23 CFNetwork/1494.0.7 Darwin/23.4.0',
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
