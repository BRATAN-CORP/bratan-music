import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { downloads } from '@/lib/offline/downloads';
import { getSavedAlbumWithTracks } from '@/lib/offline/storage';
import { networkOrLocal } from '@/lib/offline/networkOrLocal';
import type { Track, Album, Artist } from '@/types';

const PAGE_SIZE = 50;

interface AlbumDetail extends Album {
  tracks: Track[];
}

interface ArtistDetail extends Artist {
  topTracks: Track[];
  albums: Album[];
  singles: Album[];
  /** Total album count reported by Tidal's editorial artist-page
   *  module. Lets the artist page show "Показать все →" without
   *  guessing from the small first-window slice. */
  albumsMoreTotal?: number;
  singlesMoreTotal?: number;
  similarArtists: Artist[];
}

export function useTrack(id: string) {
  return useQuery({
    queryKey: ['track', id],
    queryFn: () => api.get<Track>(`/tracks/${id}`),
    enabled: !!id,
  });
}

export function useTrackRadio(id: string) {
  return useQuery({
    queryKey: ['track-radio', id],
    queryFn: () => api.get<{ items: Track[] }>(`/tracks/${id}/radio`),
    enabled: !!id,
  });
}

/**
 * Fetch album metadata + track list with an offline fallback.
 *
 * The user reported that opening a downloaded album from the
 * "Загруженное" tab in offline mode used to render "альбом не
 * найден" because the network request 404'd. The fix is "if
 * online — query the server; if offline — load the local copy"
 * (paraphrasing the user's verbatim Russian instruction). We
 * implement that in two layers:
 *
 *   1. If the device reports `navigator.onLine === false`, we read
 *      directly from IndexedDB and skip the network call entirely
 *      (saves a guaranteed-failing fetch + DNS round-trip on flaky
 *      cellular).
 *   2. If we *do* try the network and it errors out (DNS, 5xx, etc.)
 *      we attempt the offline fallback before giving up. This
 *      handles the in-between "online but unreachable" case
 *      (airplane Wi-Fi, captive portal) that the user also runs
 *      into.
 *
 * The resulting object matches the network `AlbumDetail` shape so
 * the album page renders identically; tracks that were never fully
 * downloaded are silently dropped, leaving only what the user can
 * actually play.
 */
export function useAlbum(id: string) {
  return useQuery({
    queryKey: ['album', id],
    // `networkOrLocal` falls back to the IDB snapshot the moment the
    // network call exceeds its 5-second budget, so an offline /
    // half-online device hydrates the album page from the user's
    // saved download instantly instead of sitting on a blank
    // spinner waiting for the browser-default ~60-second `fetch`
    // timeout. That blank-spinner symptom was reported by the user
    // as "офлайн: скачанные альбомы не открываются".
    queryFn: () => {
      // While a download is in flight, the IDB row only carries the
      // album shell + tracks already committed (`enqueueAlbum`
      // writes the shell upfront so "Загруженное" can show the
      // album mid-download). If we let `networkOrLocal` prefer that
      // snapshot a focus / reconnect refetch would replace the
      // full network track list with the partial saved one and the
      // user would see the album page "lose" tracks the moment the
      // first one finishes downloading. Skip the IDB read while a
      // job is active so the page keeps rendering the full track
      // list with per-track download rings — exactly the symptom
      // reported as "после загрузки одного трека страничка альбома
      // перерендеривается и я вижу только загруженные треки".
      const job = downloads.getJob(`album:${id}`);
      const isDownloading =
        !!job && (job.status === 'queued' || job.status === 'downloading');
      return networkOrLocal(
        () => api.get<AlbumDetail>(`/albums/${id}`),
        async () => (await getSavedAlbumWithTracks(id)) as AlbumDetail | null,
        { skipLocal: isDownloading },
      );
    },
    enabled: !!id,
    // The album-detail data we'd render from the offline cache is
    // identical to itself across re-fetches; let React Query keep
    // showing it instead of bouncing to a "loading" placeholder
    // every time the user navigates away and back.
    staleTime: 60_000,
  });
}

export function useArtist(id: string) {
  return useQuery({
    queryKey: ['artist', id],
    queryFn: () => api.get<ArtistDetail>(`/artists/${id}`),
    enabled: !!id,
  });
}

interface ArtistReleasesPage {
  items: Album[];
  totalItems?: number;
  morePath?: string;
}

interface ArtistReleasesPageContext {
  offset: number;
  morePath?: string;
}

/**
 * Cursor-paginated album feed for an artist's "see all" page. Backed
 * by `/artists/:id/albums?offset=N&limit=50`. Once the worker exposes
 * a `morePath` (Tidal's opaque dataApiPath for the artist page
 * module), subsequent pages route through it so we stay in lockstep
 * with whatever Tidal is paginating server-side.
 */
function useArtistReleasesInfinite(kind: 'albums' | 'singles', id: string) {
  return useInfiniteQuery({
    queryKey: [`artist-${kind}`, id] as const,
    enabled: !!id,
    initialPageParam: { offset: 0 } as ArtistReleasesPageContext,
    queryFn: async ({ pageParam }: { pageParam: ArtistReleasesPageContext }) => {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(pageParam.offset) });
      if (pageParam.morePath) params.set('morePath', pageParam.morePath);
      return api.get<ArtistReleasesPage>(`/artists/${id}/${kind}?${params}`);
    },
    getNextPageParam: (lastPage: ArtistReleasesPage, pages: ArtistReleasesPage[]): ArtistReleasesPageContext | undefined => {
      const loaded = pages.reduce((n, p) => n + p.items.length, 0);
      const total = lastPage.totalItems ?? loaded;
      if (loaded >= total || lastPage.items.length === 0) return undefined;
      return { offset: loaded, morePath: lastPage.morePath };
    },
    staleTime: 1000 * 60 * 5,
  });
}

export function useArtistAlbumsInfinite(id: string) {
  return useArtistReleasesInfinite('albums', id);
}

export function useArtistSinglesInfinite(id: string) {
  return useArtistReleasesInfinite('singles', id);
}

/**
 * Tidal "artist radio" — a seeded mix anchored to the given artist.
 * Backed by `/artists/:id/radio` and rendered as its own section on
 * the artist page. The endpoint resolves to an empty list on upstream
 * errors so the rest of the page keeps working.
 */
export function useArtistRadio(id: string) {
  return useQuery({
    queryKey: ['artist-radio', id],
    queryFn: () => api.get<{ items: Track[] }>(`/artists/${id}/radio`),
    enabled: !!id,
  });
}
