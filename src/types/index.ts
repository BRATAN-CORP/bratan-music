export interface Track {
  id: string;
  title: string;
  artist: string;
  artistId?: string;
  album?: string;
  albumId?: string;
  duration: number;
  coverUrl?: string;
  /** Animated cover (mp4) when the source provides one. Used as a tasteful
   *  loop in the fullscreen player. */
  coverVideoUrl?: string;
  /** Provider tag. Tracks without a known source default to "tidal" downstream. */
  source?: string;
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

/**
 * Editorial (Tidal-curated) playlist surfaced on Explore pages.
 * Distinct from `Playlist` (which represents the user's own
 * playlists in the library); these are read-only, UUID-keyed, and
 * never reorderable.
 */
export interface ExplorePlaylist {
  id: string;
  source: string;
  title: string;
  description?: string;
  coverUrl?: string;
  curator?: string;
  trackCount?: number;
  duration?: number;
}

export interface ExplorePageLink {
  title: string;
  /** Page slug, e.g. "genre_world", "m_1980s", "mood_focus". */
  slug: string;
  icon?: string;
  imageId?: string;
}

export type ExploreModule =
  | { type: 'pageLinks'; title: string; items: ExplorePageLink[] }
  | { type: 'tracks'; title: string; items: Track[] }
  | { type: 'albums'; title: string; items: Album[] }
  | { type: 'artists'; title: string; items: Artist[] }
  | { type: 'playlists'; title: string; items: ExplorePlaylist[] };

export interface ExplorePage {
  title: string;
  modules: ExploreModule[];
}

export interface UserLimits {
  daily: {
    used: number;
    limit: number;
    unlimited: boolean;
    remaining?: number;
  };
}
