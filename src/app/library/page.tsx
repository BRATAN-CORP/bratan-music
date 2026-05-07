import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Plus, Upload as UploadIcon, Disc3, User, Heart } from 'lucide-react';
import { AuthGuard } from '@/components/features/AuthGuard';
import { PlaylistCard } from '@/components/features/PlaylistCard';
import { AlbumCard } from '@/components/features/AlbumCard';
import { ArtistCard } from '@/components/features/ArtistCard';
import { CreatePlaylistDialog } from '@/components/features/CreatePlaylistDialog';
import { OfflineLibraryTab } from '@/components/features/OfflineLibraryTab';
import { usePlaylists, useLikedAlbums, useLikedArtists } from '@/hooks/useLibrary';
import { useUploads } from '@/hooks/useUploads';
import { useOnline } from '@/hooks/useOnline';
import { useOfflineHydration } from '@/hooks/useOfflineActions';
import { useOfflineStore } from '@/store/offline';
import { Button } from '@/components/ui/Button';
import { PageLoader } from '@/components/ui/PageLoader';
import { useT } from '@/i18n';
import type { TranslationKey } from '@/i18n';

type Tab = 'playlists' | 'albums' | 'artists' | 'downloaded';

const tabs: { key: Tab; labelKey: TranslationKey }[] = [
  { key: 'playlists', labelKey: 'library.tabPlaylists' },
  { key: 'albums', labelKey: 'library.tabAlbums' },
  { key: 'artists', labelKey: 'library.tabArtists' },
  { key: 'downloaded', labelKey: 'library.tabDownloaded' },
];

/** Cross-mount memory of the last library tab the user looked at.
 *  Lives in `sessionStorage` (not local) so it resets when the user
 *  closes the tab/PWA — coming back tomorrow lands on Playlists,
 *  but bouncing into a playlist and pressing Back returns to the
 *  same tab the user left from (Albums, Artists, Downloaded, …).
 *  Mirrored into the URL via `?tab=` as the source-of-truth so
 *  forward/back navigation through the in-app history is also
 *  restored — without that, hardware Back from a detail page would
 *  re-render `/library` with the React useState default (Playlists)
 *  even though the URL the user came from said `?tab=albums`. */
const TAB_STORAGE_KEY = 'bratan:library:tab';
const VALID_TABS: ReadonlySet<Tab> = new Set<Tab>([
  'playlists',
  'albums',
  'artists',
  'downloaded',
]);

function isValidTab(value: string | null | undefined): value is Tab {
  return value !== null && value !== undefined && VALID_TABS.has(value as Tab);
}

function readInitialTab(searchParam: string | null): Tab {
  if (isValidTab(searchParam)) return searchParam;
  if (typeof sessionStorage !== 'undefined') {
    try {
      const stored = sessionStorage.getItem(TAB_STORAGE_KEY);
      if (isValidTab(stored)) return stored;
    } catch {
      // Private mode / disabled storage — silently fall back.
    }
  }
  return 'playlists';
}

// Picks the right Russian/English plural form for the "N tracks" label.
function tracksFormKey(count: number): TranslationKey {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return 'library.trackUnit1';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'library.trackUnit2_4';
  return 'library.trackUnit5plus';
}

export function LibraryPage() {
  const t = useT();
  const { data: playlists, isLoading } = usePlaylists();
  const { data: uploads } = useUploads();
  const { data: albumsData } = useLikedAlbums();
  const { data: artistsData } = useLikedArtists();
  const [showCreate, setShowCreate] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const [tab, setTab] = useState<Tab>(() => readInitialTab(searchParams.get('tab')));

  // Sync the active tab back into both `sessionStorage` and the URL
  // so a deep-link / back-button traversal restores the user's
  // exact spot. URL is the canonical source — sessionStorage is the
  // fallback when the user lands on plain `/library` without a
  // `?tab=` (e.g. tapping the bottom-nav Library icon mid-session
  // after they were last on Albums). `replace` keeps the history
  // entry count flat so Back doesn't bounce through every tab the
  // user clicked through.
  useEffect(() => {
    if (typeof sessionStorage !== 'undefined') {
      try {
        sessionStorage.setItem(TAB_STORAGE_KEY, tab);
      } catch {
        /* private mode — non-fatal. */
      }
    }
    const current = searchParams.get('tab');
    if (current === tab) return;
    const next = new URLSearchParams(searchParams);
    if (tab === 'playlists') {
      // Default tab — keep the URL clean (`/library` with no
      // query). Avoids littering the address bar / share-sheet
      // copy with a redundant `?tab=playlists`.
      next.delete('tab');
    } else {
      next.set('tab', tab);
    }
    setSearchParams(next, { replace: true });
  }, [tab, searchParams, setSearchParams]);

  // Mirror back: if the user navigates with a fresh `?tab=` in the
  // URL (back/forward, deep-link share), pick that up so the
  // visible tab follows. Without this the URL and the rendered tab
  // could diverge after history navigation.
  useEffect(() => {
    const fromUrl = searchParams.get('tab');
    if (isValidTab(fromUrl) && fromUrl !== tab) {
      setTab(fromUrl);
    }
  }, [searchParams, tab]);

  // When the device drops the network, the existing playlist / album /
  // artist queries either return stale data (if React Query had a
  // cache hit) or nothing at all. Filter both lists down to whatever
  // is in the offline cache so the user sees only the things that
  // will actually play.
  useOfflineHydration();
  const online = useOnline();
  const savedAlbumIds = useOfflineStore((s) => s.savedAlbumIds);
  const savedPlaylistIds = useOfflineStore((s) => s.savedPlaylistIds);

  const visiblePlaylists = online
    ? playlists ?? []
    : (playlists ?? []).filter((pl) => savedPlaylistIds.has(pl.id));
  const visibleAlbums = online
    ? albumsData?.items ?? []
    : (albumsData?.items ?? []).filter((al) => savedAlbumIds.has(al.id));

  return (
    <AuthGuard>
      <div className="mx-auto flex max-w-6xl flex-col gap-6 p-4 sm:p-6 lg:p-10">
        <div
          className="flex items-end justify-between gap-4 border-b border-border pb-4"
        >
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium uppercase tracking-[0.25em] text-muted-foreground">
              {t('library.collectionLabel')}
            </span>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{t('library.title')}</h1>
          </div>
          {tab === 'playlists' && (
            <Button onClick={() => setShowCreate(true)} variant="outline">
              <Plus size={14} />
              {t('library.newPlaylistShort')}
            </Button>
          )}
        </div>

        {/* Tour target sits on the tabs row — that's the actual feature
            the body copy is describing ("likes / playlists / history"),
            not the page heading. Previously highlighted the title block
            which had nothing to do with the explanation.
            
            The row is horizontally scrollable: on narrow viewports
            (mobile portrait, especially with the iPhone safe-area
            padding chewing into the visible width) the four chips
            wouldn't fit and the rightmost one ("Загруженное") got
            visually clipped by the page padding. `overflow-x-auto`
            + `shrink-0` on each chip lets the user swipe through
            them, while `scrollbar-thin` (in `globals.scss`) keeps
            the scrollbar from looking like a dev-tool. */}
        <div
          className="-mx-4 flex gap-2 overflow-x-auto border-b border-border px-4 pb-3 sm:-mx-6 sm:px-6 lg:-mx-10 lg:px-10 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          data-tour-id="tour-library"
        >
          {tabs.map((tt) => (
            <button
              key={tt.key}
              type="button"
              onClick={() => setTab(tt.key)}
              className={`shrink-0 whitespace-nowrap rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                tab === tt.key
                  ? 'bg-foreground text-background'
                  : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
              }`}
            >
              {t(tt.labelKey)}
            </button>
          ))}
        </div>

        {tab === 'playlists' && (
          <>
            <Link
              to="/library/uploads"
              className="flex items-center gap-4 rounded-[var(--radius-md)] border border-border bg-card px-4 py-3 transition-colors hover:bg-secondary"
            >
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[var(--radius-sm)] border border-border bg-background text-[var(--color-accent)]">
                <UploadIcon size={18} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{t('library.uploadsEntry')}</p>
                <p className="text-xs text-muted-foreground">
                  {t('library.uploadsEntrySubtitle', {
                    count: uploads?.length ?? 0,
                    form: t(tracksFormKey(uploads?.length ?? 0)),
                  })}
                </p>
              </div>
            </Link>

            {isLoading ? (
              <PageLoader label={t('library.loadingShort')} />
            ) : visiblePlaylists.length ? (
              <div className="flex flex-col gap-2">
                {visiblePlaylists.map((pl) => (
                  <PlaylistCard key={pl.id} playlist={pl} />
                ))}
              </div>
            ) : (
              <div className="rounded-[var(--radius-md)] border border-border bg-card py-12 text-center text-sm text-muted-foreground">
                {t('library.noPlaylists')}
              </div>
            )}
          </>
        )}

        {tab === 'albums' && (
          <>
            {visibleAlbums.length ? (
              <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
                {visibleAlbums.map((album) => (
                  <AlbumCard
                    key={album.id}
                    album={{
                      id: album.id,
                      title: album.title,
                      artist: album.artist,
                      artistId: album.artistId,
                      coverUrl: album.coverUrl,
                    }}
                  />
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3 rounded-[var(--radius-md)] border border-border bg-card py-16 text-center">
                <Disc3 size={32} className="text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  {t('library.noAlbumsTitle')}
                </p>
                <p className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Heart size={12} /> {t('library.noAlbumsHint')}
                </p>
              </div>
            )}
          </>
        )}

        {tab === 'artists' && (
          <>
            {artistsData?.items?.length ? (
              <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 md:grid-cols-5 xl:grid-cols-6">
                {artistsData.items.map((artist) => (
                  <ArtistCard
                    key={artist.id}
                    artist={{
                      id: artist.id,
                      name: artist.name,
                      imageUrl: artist.imageUrl,
                    }}
                  />
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3 rounded-[var(--radius-md)] border border-border bg-card py-16 text-center">
                <User size={32} className="text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  {t('library.noArtistsTitle')}
                </p>
                <p className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Heart size={12} /> {t('library.noArtistsHint')}
                </p>
              </div>
            )}
          </>
        )}

        {tab === 'downloaded' && <OfflineLibraryTab />}

        <CreatePlaylistDialog open={showCreate} onClose={() => setShowCreate(false)} />
      </div>
    </AuthGuard>
  );
}
