import { TidalAuth } from './TidalAuth';

const WEB_BASE = 'https://tidal.com';

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
  album?: { id: number; title: string; cover: string | null };
}

export interface TidalAlbumRaw {
  id: number;
  title: string;
  duration?: number;
  numberOfTracks?: number;
  releaseDate?: string;
  cover?: string | null;
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

type WrappedSearchItem<T> = T | { item?: T; value?: T };

interface TidalSearchBucket<T> {
  items?: WrappedSearchItem<T>[];
  totalNumberOfItems?: number;
}

export class TidalApi {
  constructor(private auth: TidalAuth) {}

  async search(query: string, types: string = 'ARTISTS,ALBUMS,TRACKS,VIDEOS,PLAYLISTS,UPLOADS', limit: number = 25, offset: number = 0): Promise<TidalSearchResponse> {
    const cc = await this.auth.getCountryCode();
    const params = new URLSearchParams({
      includeContributors: 'true',
      includeDidYouMean: 'true',
      includeUserPlaylists: 'true',
      limit: String(limit),
      query,
      supportsUserData: 'true',
      types,
      countryCode: cc,
      locale: this.auth.getLocale(),
      deviceType: 'BROWSER',
    });
    if (offset > 0) params.set('offset', String(offset));
    return this.get<TidalSearchResponse>(`/v2/search/?${params}`);
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
    const token = await this.auth.getAccessToken();
    const res = await fetch(`${WEB_BASE}${path}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'x-tidal-client-version': this.auth.getClientVersion(),
      },
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Tidal API ${res.status}: ${text}`);
    }

    return res.json<T>();
  }
}
