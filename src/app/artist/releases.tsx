import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AlertCircle, ChevronLeft, Loader2 } from 'lucide-react';
import { AuthGuard } from '@/components/features/AuthGuard';
import { AlbumCard } from '@/components/features/AlbumCard';
import { useArtist, useArtistAlbums, useArtistSingles } from '@/hooks/useTrack';

const PAGE_SIZE = 50;

interface ArtistReleasesPageProps {
  /** Whether to show the "albums" feed (ALBUM + EP + COMPILATION) or
   *  the "singles" feed. Each kind hits a different worker endpoint
   *  but the rendering is identical, so we share one component. */
  kind: 'albums' | 'singles';
}

/**
 * "All albums" / "All singles" listing for an artist. Reuses the same
 * IntersectionObserver pagination pattern as the explore list page.
 * The worker returns the entire deduped feed in one shot; we slice
 * client-side in 50-item batches so paging doesn't trigger extra
 * round-trips.
 */
export function ArtistReleasesPage({ kind }: ArtistReleasesPageProps) {
  const { id } = useParams<{ id: string }>();
  const { data: artist } = useArtist(id ?? '');
  const albumsQ = useArtistAlbums(kind === 'albums' ? (id ?? '') : '');
  const singlesQ = useArtistSingles(kind === 'singles' ? (id ?? '') : '');
  const active = kind === 'albums' ? albumsQ : singlesQ;
  const items = useMemo(() => active.data?.items ?? [], [active.data?.items]);
  const [visible, setVisible] = useState(PAGE_SIZE);
  const heading = kind === 'albums' ? 'Все альбомы' : 'Все синглы';

  useEffect(() => {
    setVisible(PAGE_SIZE);
  }, [id, kind]);

  const hasMore = visible < items.length;
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasMore) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setVisible((n) => Math.min(n + PAGE_SIZE, items.length));
            break;
          }
        }
      },
      { rootMargin: '600px 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, items.length]);

  return (
    <AuthGuard>
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-4 sm:p-6 lg:p-10">
        <div className="flex flex-col gap-2">
          <Link
            to={`/artist/${id ?? ''}`}
            className="inline-flex w-fit items-center gap-1 text-xs font-medium uppercase tracking-[0.25em] text-muted-foreground transition-colors hover:text-foreground"
          >
            <ChevronLeft size={12} />
            {artist?.name ?? 'Назад'}
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{heading}</h1>
          {items.length > 0 && (
            <p className="text-xs text-muted-foreground">{items.length} элементов</p>
          )}
        </div>

        {active.isLoading && (
          <div className="flex items-center justify-center gap-2 py-20 text-xs text-muted-foreground">
            <Loader2 size={14} className="animate-spin" />
            Загружаем…
          </div>
        )}

        {active.error && (
          <div className="flex flex-col items-center gap-3 rounded-[var(--radius-md)] border border-border bg-card py-14 text-center">
            <AlertCircle size={24} className="text-[var(--color-danger)]" />
            <div className="text-sm">Не удалось загрузить</div>
            <div className="text-xs text-muted-foreground">
              {active.error instanceof Error ? active.error.message : 'Неизвестная ошибка'}
            </div>
          </div>
        )}

        {!active.isLoading && !active.error && items.length === 0 && (
          <p className="text-sm text-muted-foreground">Пусто.</p>
        )}

        {items.length > 0 && (
          <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
            {items.slice(0, visible).map((album) => (
              <AlbumCard key={album.id} album={album} />
            ))}
          </div>
        )}

        {hasMore && (
          <div ref={sentinelRef} className="flex items-center justify-center py-6">
            <button
              type="button"
              onClick={() => setVisible((n) => Math.min(n + PAGE_SIZE, items.length))}
              className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-xs text-muted-foreground transition-all hover:bg-secondary hover:text-foreground active:scale-95"
            >
              Показать ещё
            </button>
          </div>
        )}
      </div>
    </AuthGuard>
  );
}

export function ArtistAlbumsPage() {
  return <ArtistReleasesPage kind="albums" />;
}

export function ArtistSinglesPage() {
  return <ArtistReleasesPage kind="singles" />;
}
