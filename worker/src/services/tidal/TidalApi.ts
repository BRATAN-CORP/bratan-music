import { TidalAuth } from './TidalAuth';

const API_BASE = 'https://api.tidal.com/v1';

interface TidalSearchResponse {
  artists: { items: TidalArtistRaw[]; totalNumberOfItems: number };
  albums: { items: TidalAlbumRaw[]; totalNumberOfItems: number };
  tracks: { items: TidalTrackRaw[]; totalNumberOfItems: number };
}

export interface TidalTrackRaw {
  id: number;
  title: string;
  duration: number;
  version: string | null;
  explicit: boolean;
  popularity: number;
  trackNumber: number;
  volumeNumber: number;
  streamReady: boolean;
  allowStreaming: boolean;
  audioQuality: string;
  audioModes: string[];
  artist: { id: number; name: string };
  artists: { id: number; name: string; type: string }[];
  album: { id: number; title: string; cover: string | null };
}

export interface TidalAlbumRaw {
  id: number;
  title: string;
  duration: number;
  numberOfTracks: number;
  releaseDate: string;
  cover: string | null;
  artist: { id: number; name: string };
  artists: { id: number; name: string; type: string }[];
  audioQuality: string;
}

export interface TidalArtistRaw {
  id: number;
  name: string;
  picture: string | null;
  popularity: number;
}

export class TidalApi {
  constructor(private auth: TidalAuth) {}

  async search(query: string, types: string = 'ARTISTS,ALBUMS,TRACKS', limit: number = 25, offset: number = 0): Promise<TidalSearchResponse> {
    const cc = await this.auth.getCountryCode();
    const params = new URLSearchParams({
      query,
      types,
      limit: String(limit),
      offset: String(offset),
      countryCode: cc,
    });
    return this.get<TidalSearchResponse>(`/search?${params}`);
  }

  async getTrack(trackId: string): Promise<TidalTrackRaw> {
    const cc = await this.auth.getCountryCode();
    return this.get<TidalTrackRaw>(`/tracks/${trackId}?countryCode=${cc}`);
  }

  async getAlbum(albumId: string): Promise<TidalAlbumRaw> {
    const cc = await this.auth.getCountryCode();
    return this.get<TidalAlbumRaw>(`/albums/${albumId}?countryCode=${cc}`);
  }

  async getAlbumTracks(albumId: string, limit: number = 100): Promise<{ items: TidalTrackRaw[] }> {
    const cc = await this.auth.getCountryCode();
    return this.get<{ items: TidalTrackRaw[] }>(`/albums/${albumId}/tracks?limit=${limit}&countryCode=${cc}`);
  }

  async getArtist(artistId: string): Promise<TidalArtistRaw> {
    const cc = await this.auth.getCountryCode();
    return this.get<TidalArtistRaw>(`/artists/${artistId}?countryCode=${cc}`);
  }

  async getArtistTopTracks(artistId: string, limit: number = 10): Promise<{ items: TidalTrackRaw[] }> {
    const cc = await this.auth.getCountryCode();
    return this.get<{ items: TidalTrackRaw[] }>(`/artists/${artistId}/toptracks?limit=${limit}&countryCode=${cc}`);
  }

  async getArtistAlbums(artistId: string, limit: number = 50, filter: string = 'ALBUMS'): Promise<{ items: TidalAlbumRaw[] }> {
    const cc = await this.auth.getCountryCode();
    return this.get<{ items: TidalAlbumRaw[] }>(`/artists/${artistId}/albums?limit=${limit}&filter=${filter}&countryCode=${cc}`);
  }

  async getSimilarArtists(artistId: string, limit: number = 10): Promise<{ items: TidalArtistRaw[] }> {
    const cc = await this.auth.getCountryCode();
    return this.get<{ items: TidalArtistRaw[] }>(`/artists/${artistId}/similar?limit=${limit}&countryCode=${cc}`);
  }

  async getTrackRadio(trackId: string, limit: number = 25): Promise<{ items: TidalTrackRaw[] }> {
    const cc = await this.auth.getCountryCode();
    return this.get<{ items: TidalTrackRaw[] }>(`/tracks/${trackId}/radio?limit=${limit}&countryCode=${cc}`);
  }

  private async get<T>(path: string): Promise<T> {
    const token = await this.auth.getAccessToken();
    const res = await fetch(`${API_BASE}${path}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Tidal API ${res.status}: ${text}`);
    }

    return res.json<T>();
  }
}
