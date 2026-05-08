import { useEffect, useMemo, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { AlertCircle, ChevronLeft, Loader2 } from 'lucide-react';
import { AuthGuard } from '@/components/features/AuthGuard';
import { AlbumCard } from '@/components/features/AlbumCard';
import { ArtistCard } from '@/components/features/ArtistCard';
import { TrackItem } from '@/components/features/TrackItem';
import { PageLoader } from '@/components/ui/PageLoader';
import { Eyebrow } from '@/components/ui/SectionHeading';
import { useExplorePage, useExploreList } from '@/hooks/useExplore';
import { usePlayerStore } from '@/store/player';
import { useT } from '@/i18n';
import type {
  Album,
  Artist,
  ExplorePlaylist,
  Track,
  ExploreModule,
  ExploreModuleType,
} from '@/types';

/**
 * "Смотреть все" — dedicated page that fully lists a single module
 * from an explore page (tracks / albums / artists / playlists) with
 * infinite scroll. The module is identified by its index in the
 * parent explore page; the parent page is fetched so we can read
 * the module's title, type and `moreApiPath` opaque pagination
 * handle without forcing the user to pass them through the URL.
 */
export function ExploreListPage() {
  const t = useT();
  const { slug, moduleIndex } = useParams<{ slug: string; moduleIndex: string }>();
  const idx = moduleIndex ? Number.parseInt(moduleIndex, 10) : NaN;
  const {
    data: page,
    isLoading: pageLoading,
    error: pageError,
  } = useExplorePage(slug);

  const module: ExploreModule | null =
    page && Number.isFinite(idx) && idx >= 0 && idx < page.modules.length
      ? page.modules[idx] ?? null
      : null;

  const moreApiPath = module && module.type !== 'pageLinks' ? module.moreApiPath : undefined;
  const type: ExploreModuleType | null = module ? module.type : null;

  const {
    data: pages,
    isLoading: listLoading,
    error: listError,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useExploreList({
    moreApiPath: moreApiPath ?? null,
    // useExploreList is `enabled` only when moreApiPath is truthy, so
    // the `type` value for a null module is irrelevant — we fall back
    // to 'tracks' purely to satisfy the hook's non-null signature.
    type: type ?? 'tracks',
  });

  // Merge the initial page's items (already rendered in the explore
  // row) with subsequently paginated items. Dedup by id so if
  // offset=0 returns the same top items we won't render them twice.
  const allItems = useMemo(() => {
    if (!module) return [] as (Track | Album | Artist | ExplorePlaylist)[];
    const seen = new Set<string>();
    const out: (Track | Album | Artist | ExplorePlaylist)[] = [];
    const push = (item: Track | Album | Artist | ExplorePlaylist) => {
      const id = String((item as { id?: string }).id ?? '');
      if (!id || seen.has(id)) return;
      seen.add(id);
      out.push(item);
    };
    // PageLinks modules don't support the list view — handled as
    // an early return below; this branch narrows the item type.
    if (module.type === 'pageLinks') return out;
    for (const it of module.items) push(it);
    if (pages) {
      for (const p of pages.pages) {
        for (const it of p.items as (Track | Album | Artist | ExplorePlaylist)[]) push(it);
      }
    }
    return out;
  }, [module, pages]);

  // Infinite scroll sentinel — when this div scrolls into view and
  // more pages exist, request the next window. Uses the standard
  // IntersectionObserver so the browser does the throttling for us.
  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    if (!hasNextPage || isFetchingNextPage) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            fetchNextPage();
            break;
          }
        }
      },
      { rootMargin: '600px 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  return (
    <AuthGuard>
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-4 sm:p-6 lg:p-10">
        <div className="flex flex-col gap-2">
          <Eyebrow
            as={Link}
            to={slug ? `/explore/${slug}` : '/search'}
            className="inline-flex w-fit items-center gap-1 transition-colors hover:text-foreground"
          >
            <ChevronLeft size={12} />
            {page?.title ?? t('exploreList.back')}
          </Eyebrow>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            {module?.title ?? t('exploreList.fallbackAll')}
          </h1>
          {typeof module?.totalItems === 'number' && module.totalItems > 0 && (
            <p className="text-xs text-muted-foreground">
              {t('exploreList.itemsCount', { count: module.totalItems })}
            </p>
          )}
        </div>

        {pageLoading && <PageLoader label={t('exploreList.loading')} />}

        {(pageError || listError) && (
          <div className="flex flex-col items-center gap-3 rounded-[var(--radius-md)] border border-border bg-card py-14 text-center">
            <AlertCircle size={24} className="text-[var(--color-danger)]" />
            <div className="text-sm">{t('exploreList.failedTitle')}</div>
            <div className="text-xs text-muted-foreground">
              {(pageError || listError) instanceof Error
                ? ((pageError || listError) as Error).message
                : t('exploreList.unknownError')}
            </div>
          </div>
        )}

        {module && module.type === 'pageLinks' && (
          <div className="rounded-[var(--radius-md)] border border-border bg-card p-6 text-sm text-muted-foreground">
            {t('exploreList.pageless')}
          </div>
        )}

        {module && module.type !== 'pageLinks' && (
          <ListView type={module.type} items={allItems} />
        )}

        {/* Infinite-scroll sentinel + loading indicator. Only rendered
            when more pages are known to exist so we don't confuse the
            user with an eternal spinner at the end of a finished list. */}
        {hasNextPage && (
          <div ref={sentinelRef} className="flex items-center justify-center py-6">
            {(isFetchingNextPage || listLoading) && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 size={14} className="animate-spin" />
                {t('exploreList.loadingMore')}
              </div>
            )}
          </div>
        )}
      </div>
    </AuthGuard>
  );
}

/**
 * Render the paginated items using the same layout primitives the
 * main explore page uses for that module type. Tracks as a vertical
 * list (reuses TrackItem so play/pause/like are identical), albums
 * and artists as a responsive grid, and playlists as a responsive
 * grid of the editorial playlist cards.
 */
function ListView({
  type,
  items,
}: {
  type: Exclude<ExploreModuleType, 'pageLinks'>;
  items: (Track | Album | Artist | ExplorePlaylist)[];
}) {
  const t = useT();
  const setTrack = usePlayerStore((s) => s.setTrack);
  const setQueue = usePlayerStore((s) => s.setQueue);

  if (type === 'tracks') {
    const tracks = items as Track[];
    const handlePlay = (track: Track) => {
      setQueue(tracks);
      setTrack({
        id: track.id,
        title: track.title,
        artist: track.artist,
        artistId: track.artistId,
        artists: track.artists,
        coverUrl: track.coverUrl,
        coverVideoUrl: track.coverVideoUrl,
        duration: track.duration,
      });
    };
    return (
      <div className="rounded-[var(--radius-md)] border border-border bg-background">
        {tracks.map((tr, i) => (
          <TrackItem key={tr.id} track={tr} index={i} onPlay={handlePlay} />
        ))}
      </div>
    );
  }

  if (type === 'albums') {
    const albums = items as Album[];
    return (
      <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
        {albums.map((a) => (
          <AlbumCard key={a.id} album={a} />
        ))}
      </div>
    );
  }

  if (type === 'artists') {
    const artists = items as Artist[];
    return (
      <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 md:grid-cols-5 xl:grid-cols-6">
        {artists.map((a) => (
          <ArtistCard key={a.id} artist={a} />
        ))}
      </div>
    );
  }

  const playlists = items as ExplorePlaylist[];
  return (
    <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
      {playlists.map((p) => (
        <Link
          key={p.id}
          to={`/explore/playlist/${p.id}`}
          className="group flex flex-col gap-2.5 focus:outline-none"
          aria-label={t('exploreList.openPlaylist', { title: p.title })}
        >
          <div className="relative aspect-square w-full overflow-hidden rounded-[var(--radius-md)] border border-border bg-secondary shadow-sm transition-shadow duration-300 group-hover:shadow-xl">
            {p.coverUrl ? (
              <img
                src={p.coverUrl}
                alt={p.title}
                loading="lazy"
                className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
              />
            ) : null}
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="line-clamp-2 text-sm font-medium">{p.title}</span>
            {p.curator && (
              <span className="text-xs text-muted-foreground">{p.curator}</span>
            )}
          </div>
        </Link>
      ))}
    </div>
  );
}
