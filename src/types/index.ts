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
  /** Owner's "make public" toggle. */
  isPublic?: boolean;
  /** Opaque token used in `/p/:token` share URLs. Null if never published. */
  shareToken?: string | null;
  /**
   * "user" — saved reference to another user's public playlist.
   * "tidal" — saved reference to a Tidal editorial playlist.
   * null — playlist owned and authored by this user.
   *
   * Linked playlists are read-only: rename / cover / reorder / add /
   * remove are all blocked on the backend and hidden in the UI.
   */
  sourceKind?: 'user' | 'tidal' | null;
  /** ID of the source playlist (Tidal UUID for tidal sources, user
   *  playlist id for user sources). */
  sourcePlaylistId?: string | null;
  /** ID of the original owner. Only meaningful when sourceKind='user'. */
  sourceUserId?: string | null;
  /** Echoed by `/playlists/:id` so the UI doesn't re-derive it. */
  readOnly?: boolean;
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
