export interface Track {
  id: string;
  source: 'tidal' | 'soundcloud' | 'youtube';
  title: string;
  artist: string;
  artistId?: string;
  album?: string;
  albumId?: string;
  duration: number;
  coverUrl?: string;
  explicit: boolean;
  quality?: string;
}

export interface Album {
  id: string;
  source: string;
  title: string;
  artist: string;
  artistId?: string;
  coverUrl?: string;
  releaseDate?: string;
  tracks: Track[];
}

export interface Artist {
  id: string;
  source: string;
  name: string;
  imageUrl?: string;
}

export interface SearchResult {
  tracks: Track[];
  albums: Album[];
  artists: Artist[];
}

export interface MusicService {
  search(query: string, filter: 'all' | 'tracks' | 'albums' | 'artists'): Promise<SearchResult>;
  getTrack(id: string): Promise<Track>;
  getAlbum(id: string): Promise<Album>;
  getArtist(id: string): Promise<Artist>;
  getStreamUrl(trackId: string): Promise<string>;
  getDownloadUrl(trackId: string): Promise<string>;
}
