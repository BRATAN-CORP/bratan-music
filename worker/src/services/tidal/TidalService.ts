import type { Env } from '../../types/env';
import type {
  Track,
  Album,
  Artist,
  SearchResult,
  MusicService,
  ExplorePage,
  ExploreModule,
  ExplorePlaylist,
  ExplorePageLink,
} from '../../types/music';
import { TidalAuth } from './TidalAuth';
import { TidalApi } from './TidalApi';
import type {
  TidalTrackRaw,
  TidalAlbumRaw,
  TidalArtistRaw,
  TidalPageModuleRaw,
  TidalPlaylistRaw,
  TidalPageLinkRaw,
  TidalPagedListRaw,
} from './TidalApi';
import { TidalWeb } from './TidalWeb';

const IMG_BASE = 'https://resources.tidal.com/images';

function coverUrl(coverId: string | null | undefined, size: number = 640): string | undefined {
  if (!coverId) return undefined;
  return `${IMG_BASE}/${coverId.replace(/-/g, '/')}/${size}x${size}.jpg`;
}

const VIDEO_BASE = 'https://resources.tidal.com/videos';

/**
 * Construct the URL for an animated cover (mp4) at the given size. Only some
 * Tidal albums expose this — when present the API returns a UUID under
 * `videoCover`, identical encoding to image covers (dashes → slashes).
 */
function videoCoverUrl(videoId: string | null | undefined, size: number = 1280): string | undefined {
  if (!videoId) return undefined;
  return `${VIDEO_BASE}/${videoId.replace(/-/g, '/')}/${size}x${size}.mp4`;
}

function artistImageUrl(pictureId: string | null | undefined, size: number = 480): string | undefined {
  if (!pictureId) return undefined;
  return `${IMG_BASE}/${pictureId.replace(/-/g, '/')}/${size}x${size}.jpg`;
}

/**
 * Dedupe contributor list while preserving upstream order. Tidal
 * occasionally repeats the same artist across `MAIN`/`FEATURED`
 * entries — we keep just the first occurrence so the UI doesn't
 * render the same name twice.
 */
function dedupeArtistRefs(list: { id: number; name: string }[] | undefined): { id: string; name: string }[] | undefined {
  if (!list || list.length === 0) return undefined;
  const seen = new Set<string>();
  const out: { id: string; name: string }[] = [];
  for (const a of list) {
    const id = String(a.id);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ id, name: a.name });
  }
  return out.length > 0 ? out : undefined;
}

function mapTrack(raw: TidalTrackRaw): Track {
  const artists = dedupeArtistRefs(raw.artists);
  const mainArtist = raw.artist ?? raw.artists?.[0];
  return {
    id: String(raw.id),
    source: 'tidal',
    title: raw.title + (raw.version ? ` (${raw.version})` : ''),
    artist: artists?.map(a => a.name).join(', ') || mainArtist?.name || 'Unknown Artist',
    artistId: mainArtist ? String(mainArtist.id) : undefined,
    artists,
    album: raw.album?.title ?? '',
    albumId: raw.album ? String(raw.album.id) : undefined,
    duration: raw.duration,
    coverUrl: coverUrl(raw.album?.cover),
    coverVideoUrl: videoCoverUrl(raw.album?.videoCover),
    explicit: raw.explicit ?? false,
    quality: raw.audioQuality ?? 'HIGH',
  };
}

function mapAlbum(raw: TidalAlbumRaw, tracks: Track[] = []): Album {
  const artists = dedupeArtistRefs(raw.artists);
  const mainArtist = raw.artist ?? raw.artists?.[0];
  return {
    id: String(raw.id),
    source: 'tidal',
    title: raw.title,
    artist: artists?.map(a => a.name).join(', ') || mainArtist?.name || 'Unknown Artist',
    artistId: mainArtist ? String(mainArtist.id) : undefined,
    artists,
    coverUrl: coverUrl(raw.cover),
    coverVideoUrl: videoCoverUrl(raw.videoCover),
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

function mapExplorePlaylist(raw: TidalPlaylistRaw): ExplorePlaylist {
  // Square cover renders better in our grids; fall back to wide image.
  const cover = raw.squareImage ?? raw.image ?? null;
  return {
    id: raw.uuid,
    source: 'tidal',
    title: raw.title,
    description: raw.description ?? undefined,
    coverUrl: coverUrl(cover, 480),
    curator: raw.creator?.name ?? undefined,
    trackCount: raw.numberOfTracks,
    duration: raw.duration,
  };
}

function mapPageLink(raw: TidalPageLinkRaw): ExplorePageLink | null {
  // The slug is everything after `pages/` — stable across countries.
  const apiPath = raw.apiPath ?? '';
  const slug = apiPath.replace(/^pages\//, '');
  if (!slug) return null;
  return {
    title: raw.title,
    slug,
    icon: raw.icon ?? undefined,
    imageId: raw.imageId ?? undefined,
  };
}

/**
 * Map a single Tidal page module into our normalised shape. Returns
 * null for module types we don't render — keeps the response payload
 * lean and lets the frontend assume every entry is renderable.
 */
function mapPageModule(raw: TidalPageModuleRaw): ExploreModule | null {
  const title = raw.title ?? '';
  const list = raw.pagedList?.items ?? [];
  const total = raw.pagedList?.totalNumberOfItems;
  const rawMorePath = raw.pagedList?.dataApiPath;
  // Only advertise a "show more" path to the client when more items
  // actually exist beyond what the initial page window already
  // returned. Skips the pagination UI for full rows that came back
  // in a single shot.
  const hasMore = total !== undefined && total > list.length;
  const moreApiPath = hasMore ? rawMorePath : undefined;
  const totalItems = total;

  switch (raw.type) {
    case 'PAGE_LINKS':
    case 'PAGE_LINKS_CLOUD': {
      const items = (list as TidalPageLinkRaw[])
        .map(mapPageLink)
        .filter((l): l is ExplorePageLink => l !== null);
      if (items.length === 0) return null;
      return { type: 'pageLinks', title, items, moreApiPath, totalItems };
    }
    case 'TRACK_LIST': {
      const items = (list as TidalTrackRaw[]).map(mapTrack);
      if (items.length === 0) return null;
      return { type: 'tracks', title, items, moreApiPath, totalItems };
    }
    case 'ALBUM_LIST': {
      const items = (list as TidalAlbumRaw[]).map((a) => mapAlbum(a));
      if (items.length === 0) return null;
      return { type: 'albums', title, items, moreApiPath, totalItems };
    }
    case 'ARTIST_LIST': {
      const items = (list as TidalArtistRaw[]).map(mapArtist);
      if (items.length === 0) return null;
      return { type: 'artists', title, items, moreApiPath, totalItems };
    }
    case 'PLAYLIST_LIST':
    case 'MIX_LIST': {
      const items = (list as TidalPlaylistRaw[])
        .filter((p) => p && p.uuid)
        .map(mapExplorePlaylist);
      if (items.length === 0) return null;
      return { type: 'playlists', title, items, moreApiPath, totalItems };
    }
    default:
      // VIDEO_LIST, FEATURED, MIX_HEADER, etc. — nothing to do until
      // we ship video / mix surfaces in the player.
      return null;
  }
}

export class TidalService implements MusicService {
  private api: TidalApi;
  private web: TidalWeb;

  constructor(env: Env) {
    const auth = new TidalAuth(env);
    this.api = new TidalApi(auth);
    this.web = new TidalWeb(auth);
  }

  async search(
    query: string,
    filter: 'all' | 'tracks' | 'albums' | 'artists',
    opts: { limit?: number; offset?: number } = {},
  ): Promise<SearchResult> {
    const typeMap: Record<string, string> = {
      all: 'ARTISTS,ALBUMS,TRACKS',
      tracks: 'TRACKS',
      albums: 'ALBUMS',
      artists: 'ARTISTS',
    };

    const data = await this.api.search(query, typeMap[filter], opts.limit, opts.offset);

    return {
      tracks: this.api.unwrapSearchItems(data.tracks).map(mapTrack),
      albums: this.api.unwrapSearchItems(data.albums).map(a => mapAlbum(a)),
      artists: this.api.unwrapSearchItems(data.artists).map(mapArtist),
      totalTracks: data.tracks?.totalNumberOfItems,
      totalAlbums: data.albums?.totalNumberOfItems,
      totalArtists: data.artists?.totalNumberOfItems,
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

  async getTrackRadio(id: string, limit: number = 25): Promise<Track[]> {
    const res = await this.api.getTrackRadio(id, limit);
    return res.items.map(mapTrack);
  }

  async getStreamUrl(trackId: string, quality?: string): Promise<string> {
    return this.web.getStreamUrl(trackId, quality ?? 'HIGH');
  }

  async getDownloadUrl(trackId: string): Promise<string> {
    return this.web.getDownloadUrl(trackId, 'LOSSLESS');
  }

  /**
   * Fetch a Tidal page (Explore, Genre, Mood, Decade, …) and return
   * a normalised `ExplorePage` ready for the frontend. Unknown
   * modules are dropped — see `mapPageModule`.
   */
  async getExplorePage(slug: string): Promise<ExplorePage> {
    const raw = await this.api.getPage(slug);
    const modules: ExploreModule[] = [];
    for (const row of raw.rows ?? []) {
      for (const m of row.modules ?? []) {
        const normalised = mapPageModule(m);
        if (normalised) modules.push(normalised);
      }
    }
    return { title: raw.title, modules };
  }

  /**
   * Paginate a single module from a Tidal page — the "show all" flow.
   * `moreApiPath` is the opaque `pagedList.dataApiPath` previously
   * returned on an `ExploreModule`. The module type is supplied by
   * the caller so we know how to map the opaque upstream items into
   * our normalised domain shape.
   */
  async getExploreList(
    moreApiPath: string,
    type: ExploreModule['type'],
    opts: { limit?: number; offset?: number } = {},
  ): Promise<{ items: unknown[]; totalItems?: number }> {
    const raw = await this.api.getPageData<TidalPagedListRaw<unknown>>(moreApiPath, opts);
    const list = raw.items ?? [];
    const totalItems = raw.totalNumberOfItems;
    switch (type) {
      case 'tracks':
        return { items: (list as TidalTrackRaw[]).map(mapTrack), totalItems };
      case 'albums':
        return { items: (list as TidalAlbumRaw[]).map((a) => mapAlbum(a)), totalItems };
      case 'artists':
        return { items: (list as TidalArtistRaw[]).map(mapArtist), totalItems };
      case 'playlists':
        return {
          items: (list as TidalPlaylistRaw[])
            .filter((p) => p && p.uuid)
            .map(mapExplorePlaylist),
          totalItems,
        };
      case 'pageLinks':
        return {
          items: (list as TidalPageLinkRaw[])
            .map(mapPageLink)
            .filter((l): l is ExplorePageLink => l !== null),
          totalItems,
        };
    }
  }

  /**
   * Resolve tracks of an editorial Tidal playlist by UUID. Used by
   * linked playlists (sourceKind='tidal') so the saved reference
   * always reflects the upstream contents, and by the explore detail
   * view when a curated playlist is opened directly.
   */
  async getPlaylistTracks(uuid: string, limit = 100): Promise<Track[]> {
    const raw = await this.api.getPlaylistTracks(uuid, limit);
    return raw.items.map(mapTrack);
  }
}
