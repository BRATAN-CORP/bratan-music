import type { Env } from '../../types/env';
import type { Track, Album, Artist, SearchResult, MusicService } from '../../types/music';
import { TidalAuth } from './TidalAuth';
import { TidalApi } from './TidalApi';
import type { TidalTrackRaw, TidalAlbumRaw, TidalArtistRaw } from './TidalApi';
import { TidalWeb } from './TidalWeb';

const IMG_BASE = 'https://resources.tidal.com/images';

function coverUrl(coverId: string | null | undefined, size: number = 640): string | undefined {
  if (!coverId) return undefined;
  return `${IMG_BASE}/${coverId.replace(/-/g, '/')}/${size}x${size}.jpg`;
}

function artistImageUrl(pictureId: string | null | undefined, size: number = 480): string | undefined {
  if (!pictureId) return undefined;
  return `${IMG_BASE}/${pictureId.replace(/-/g, '/')}/${size}x${size}.jpg`;
}

function mapTrack(raw: TidalTrackRaw): Track {
  const mainArtist = raw.artist ?? raw.artists?.[0];
  return {
    id: String(raw.id),
    source: 'tidal',
    title: raw.title + (raw.version ? ` (${raw.version})` : ''),
    artist: raw.artists?.map(a => a.name).join(', ') || mainArtist?.name || 'Unknown Artist',
    artistId: mainArtist ? String(mainArtist.id) : undefined,
    album: raw.album?.title ?? '',
    albumId: raw.album ? String(raw.album.id) : undefined,
    duration: raw.duration,
    coverUrl: coverUrl(raw.album?.cover),
    explicit: raw.explicit ?? false,
    quality: raw.audioQuality ?? 'HIGH',
  };
}

function mapAlbum(raw: TidalAlbumRaw, tracks: Track[] = []): Album {
  const mainArtist = raw.artist ?? raw.artists?.[0];
  return {
    id: String(raw.id),
    source: 'tidal',
    title: raw.title,
    artist: mainArtist?.name ?? 'Unknown Artist',
    artistId: mainArtist ? String(mainArtist.id) : undefined,
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
      tracks: this.api.unwrapSearchItems(data.tracks).map(mapTrack),
      albums: this.api.unwrapSearchItems(data.albums).map(a => mapAlbum(a)),
      artists: this.api.unwrapSearchItems(data.artists).map(mapArtist),
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
