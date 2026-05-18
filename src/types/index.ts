/**
 * Lightweight credit reference used for multi-artist authorship.
 * Tidal returns several `{id, name}` rows on a track / album; we
 * preserve them so each contributor is independently clickable.
 */
export interface ArtistRef {
  id: string;
  name: string;
}

export interface Track {
  id: string;
  title: string;
  artist: string;
  artistId?: string;
  /**
   * Full credit list when the upstream surfaces multiple contributors.
   * `artist` (joined string) and `artistId` (primary) stay populated for
   * legacy paths; UI prefers `artists` when present so every name is its
   * own clickable link to the corresponding artist page.
   */
  artists?: ArtistRef[];
  album?: string;
  albumId?: string;
  duration: number;
  coverUrl?: string;
  /** Animated cover (mp4) when the source provides one. Used as a tasteful
   *  loop in the fullscreen player. */
  coverVideoUrl?: string;
  /** Provider tag. Tracks without a known source default to "tidal" downstream. */
  source?: string;
  /**
   * Source-provider "Explicit" flag. Surfaced as a small "E" badge next to
   * the title across every track-row, queue entry, and player surface so the
   * listener can tell at a glance which versions contain uncensored language.
   * Defaults to undefined / false when the source omits it — we never invent
   * a value, the badge only renders for explicit-true tracks.
   */
  explicit?: boolean;
}

export interface Album {
  id: string;
  title: string;
  artist: string;
  artistId: string;
  /** Full credit list — see `Track.artists`. */
  artists?: ArtistRef[];
  /** Tidal release type — ALBUM | EP | SINGLE | COMPILATION. */
  releaseType?: 'ALBUM' | 'EP' | 'SINGLE' | 'COMPILATION';
  coverUrl?: string;
  coverVideoUrl?: string;
  releaseDate?: string;
  /**
   * Source-provider Explicit flag for the release as a whole. Tidal
   * stamps this on albums that contain any explicit track, which is
   * exactly what tidal.com renders next to the cover. Defaults to
   * undefined when upstream omits it (legacy snapshots etc.).
   */
  explicit?: boolean;
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
  totalTracks?: number;
  totalAlbums?: number;
  totalArtists?: number;
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
  /**
   * Whether the editorial playlist contains explicit material. Mirrors
   * Album.explicit — Tidal sets this when the curated track list has
   * any uncensored song. Used to render the `E` badge next to the
   * title on cards and hero.
   */
  explicit?: boolean;
}

export interface ExplorePageLink {
  title: string;
  /** Page slug, e.g. "genre_world", "m_1980s", "mood_focus". */
  slug: string;
  icon?: string;
  imageId?: string;
}

/**
 * Pagination handles for a module that supports "Смотреть все".
 * `moreApiPath` is an opaque Tidal path (`pages/data/<uuid>`) passed
 * to `GET /explore/list` on the worker to fetch subsequent windows.
 * `totalItems` is the total count upstream reported so the client
 * can stop requesting pages when the list has been exhausted.
 */
interface ExploreModuleMore {
  moreApiPath?: string;
  totalItems?: number;
}

export type ExploreModule =
  | ({ type: 'pageLinks'; title: string; items: ExplorePageLink[] } & ExploreModuleMore)
  | ({ type: 'tracks'; title: string; items: Track[] } & ExploreModuleMore)
  | ({ type: 'albums'; title: string; items: Album[] } & ExploreModuleMore)
  | ({ type: 'artists'; title: string; items: Artist[] } & ExploreModuleMore)
  | ({ type: 'playlists'; title: string; items: ExplorePlaylist[] } & ExploreModuleMore);

export type ExploreModuleType = ExploreModule['type'];

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
