/**
 * Lightweight credit reference for multi-artist authorship. Tidal
 * returns each contributor as `{id, name}`; we forward the whole
 * list so the frontend can render every name as its own link.
 */
export interface ArtistRef {
  id: string;
  name: string;
}

export interface Track {
  id: string;
  source: 'tidal' | 'soundcloud' | 'youtube';
  title: string;
  artist: string;
  artistId?: string;
  /** Full credit list when upstream provides multiple contributors. */
  artists?: ArtistRef[];
  album?: string;
  albumId?: string;
  duration: number;
  coverUrl?: string;
  /** Animated cover (mp4) when the source provides one. */
  coverVideoUrl?: string;
  explicit: boolean;
  quality?: string;
}

/**
 * What kind of release this is. Used by the artist page to group
 * albums / EPs / singles / compilations into a single section while
 * still letting the UI label and order them.
 */
export type AlbumReleaseType = 'ALBUM' | 'EP' | 'SINGLE' | 'COMPILATION';

export interface Album {
  id: string;
  source: string;
  title: string;
  artist: string;
  artistId?: string;
  /** Full credit list — see `Track.artists`. */
  artists?: ArtistRef[];
  coverUrl?: string;
  coverVideoUrl?: string;
  releaseDate?: string;
  /**
   * Tidal-classified release type. Optional because non-Tidal sources
   * and legacy snapshots don't supply it; the UI falls back to
   * "ALBUM" labelling when missing.
   */
  releaseType?: AlbumReleaseType;
  /**
   * Source-provider explicit flag for the release as a whole. Tidal
   * sets this on the album level whenever ANY track is explicit, which
   * matches what their own grid shows — the badge sits next to album
   * art on cards, the hero title, and search results. Defaults to
   * false when upstream omits it.
   */
  explicit?: boolean;
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
  /**
   * Total counts reported by the upstream search, used by the UI to
   * decide whether to keep requesting more pages when infinite
   * scroll runs out of items. Undefined when upstream didn't return
   * the count (rare — Tidal always does, but defensive).
   */
  totalTracks?: number;
  totalAlbums?: number;
  totalArtists?: number;
}

/**
 * Tidal-style editorial playlist (i.e. one curated by Tidal staff,
 * not a user playlist). UUID-keyed instead of numeric to match the
 * upstream identifier — keeps deep links stable across page loads.
 */
export interface ExplorePlaylist {
  id: string;
  source: string;
  title: string;
  description?: string;
  coverUrl?: string;
  /** Author / curator of the playlist (e.g. "Tidal" or a user name). */
  curator?: string;
  trackCount?: number;
  duration?: number;
  /**
   * Whether the playlist as a whole is flagged explicit by Tidal. Mirrors
   * the album-level flag — Tidal stamps this on any editorial playlist
   * that contains explicit material. Defaults to false / undefined when
   * upstream doesn't expose it.
   */
  explicit?: boolean;
}

/**
 * Hyperlink to another Tidal page (genre/mood/decade/etc.). Caller
 * uses `slug` to fetch the next page; `imageId` is rendered as a
 * background tile.
 */
export interface ExplorePageLink {
  title: string;
  /** Page slug like "genre_world", suitable for `/explore/page/:slug`. */
  slug: string;
  /** Tidal-internal short name (e.g. "world", "pop"). */
  icon?: string;
  /** Tidal-internal image identifier. */
  imageId?: string;
}

/**
 * Normalised explore module. Each row from the Tidal page response
 * collapses into one of these so the frontend doesn't have to know
 * about the upstream module-type taxonomy.
 */
/**
 * Pagination metadata for a module that supports "show all".
 * `moreApiPath` is Tidal's `pagedList.dataApiPath` — an opaque
 * URL fragment like `pages/data/<uuid>` we pass to
 * `GET /explore/list` to load subsequent windows. Present only for
 * modules where the upstream pagedList exposed it (typically
 * tracks/albums/playlists/artists rows with totalNumberOfItems >
 * items.length). `totalItems` is populated when the upstream server
 * knows the full count so the client can stop fetching once we've
 * seen them all.
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

export interface ExplorePage {
  title: string;
  modules: ExploreModule[];
}

export interface MusicService {
  search(
    query: string,
    filter: 'all' | 'tracks' | 'albums' | 'artists',
    opts?: { limit?: number; offset?: number },
  ): Promise<SearchResult>;
  getTrack(id: string): Promise<Track>;
  getAlbum(id: string): Promise<Album>;
  getArtist(id: string): Promise<Artist>;
  getStreamUrl(trackId: string, quality?: string): Promise<string>;
  getDownloadUrl(trackId: string): Promise<string>;
}
