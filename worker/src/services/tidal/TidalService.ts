import type { Env } from '../../types/env';
import type { Track, Album, Artist, SearchResult, MusicService } from '../../types/music';
import { TidalAuth } from './TidalAuth';
import { TidalApi } from './TidalApi';
import type { TidalTrackRaw, TidalAlbumRaw, TidalArtistRaw } from './TidalApi';
import { TidalWeb } from './TidalWeb';

const IMG_BASE = 'https://resources.tidal.com/images';

function coverUrl(coverId: string | null, size: number = 640): string | undefined {
  if (!coverId) return undefined;
  return `${IMG_BASE}/${coverId.replace(/-/g, '/')}/${size}x${size}.jpg`;
}

function artistImageUrl(pictureId: string | null, size: number = 480): string | undefined {
  if (!pictureId) return undefined;
  return `${IMG_BASE}/${pictureId.replace(/-/g, '/')}/${size}x${size}.jpg`;
}

function mapTrack(raw: TidalTrackRaw): Track {
  return {
    id: String(raw.id),
    source: 'tidal',
    title: raw.title + (raw.version ? ` (${raw.version})` : ''),
    artist: raw.artists.map(a => a.name).join(', '),
    album: raw.album?.title,
    duration: raw.duration,
    coverUrl: coverUrl(raw.album?.cover),
    explicit: raw.explicit,
    quality: raw.audioQuality,
  };
}

function mapAlbum(raw: TidalAlbumRaw, tracks: Track[] = []): Album {
  return {
    id: String(raw.id),
    source: 'tidal',
    title: raw.title,
    artist: raw.artist.name,
    coverUrl: coverUrl(raw.cover),
    releaseDate: raw.releaseDate,
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

export class TidalService implements MusicService {
  private api: TidalApi;
  private web: TidalWeb;

  constructor(env: Env) {
    const auth = new TidalAuth(env);
    this.api = new TidalApi(auth);
    this.web = new TidalWeb(auth);
  }

  async search(query: string, filter: 'all' | 'tracks' | 'albums' | 'artists'): Promise<SearchResult> {
    const typeMap: Record<string, string> = {
      all: 'ARTISTS,ALBUMS,TRACKS',
      tracks: 'TRACKS',
      albums: 'ALBUMS',
      artists: 'ARTISTS',
    };

    const data = await this.api.search(query, typeMap[filter]);

    return {
      tracks: (data.tracks?.items ?? []).map(mapTrack),
      albums: (data.albums?.items ?? []).map(a => mapAlbum(a)),
      artists: (data.artists?.items ?? []).map(mapArtist),
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
    return res.items.map(mapTrack);
  }

  async getArtistAlbums(id: string): Promise<Album[]> {
    const res = await this.api.getArtistAlbums(id);
    return res.items.map(a => mapAlbum(a));
  }

  async getSimilarArtists(id: string): Promise<Artist[]> {
    const res = await this.api.getSimilarArtists(id);
    return res.items.map(mapArtist);
  }

  async getTrackRadio(id: string): Promise<Track[]> {
    const res = await this.api.getTrackRadio(id);
    return res.items.map(mapTrack);
  }

  async getStreamUrl(trackId: string): Promise<string> {
    return this.web.getStreamUrl(trackId, 'HIGH');
  }

  async getDownloadUrl(trackId: string): Promise<string> {
    return this.web.getDownloadUrl(trackId, 'LOSSLESS');
  }
}
