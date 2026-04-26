export interface Track {
  id: string;
  title: string;
  artist: string;
  artistId: string;
  album: string;
  albumId: string;
  duration: number;
  coverUrl?: string;
  /** Animated cover (mp4) when the source provides one. Used as a tasteful
   *  loop in the fullscreen player. */
  coverVideoUrl?: string;
}

export interface Album {
  id: string;
  title: string;
  artist: string;
  artistId: string;
  coverUrl?: string;
  coverVideoUrl?: string;
  releaseDate?: string;
  tracks?: Track[];
}

export interface Artist {
  id: string;
  name: string;
  imageUrl?: string;
}

export interface SearchResult {
  tracks: Track[];
  albums: Album[];
  artists: Artist[];
}

export interface Playlist {
  id: string;
  name: string;
  trackCount: number;
  isLiked: boolean;
  coverUrl?: string | null;
  pinnedAt?: number | null;
  updatedAt: number;
}

export interface UserLimits {
  daily: {
    used: number;
    limit: number;
    unlimited: boolean;
    remaining?: number;
  };
}
