import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Plus,
  Upload as UploadIcon,
  Disc3,
  User,
  Heart,
  ListMusic,
  Sparkles,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { AuthGuard } from '@/components/features/AuthGuard';
import { PlaylistCard } from '@/components/features/PlaylistCard';
import { AlbumCard } from '@/components/features/AlbumCard';
import { ArtistCard } from '@/components/features/ArtistCard';
import { CreatePlaylistDialog } from '@/components/features/CreatePlaylistDialog';
import { OfflineLibraryTab } from '@/components/features/OfflineLibraryTab';
import { LibraryHero } from '@/components/features/LibraryHero';
import { LibraryStatsRow } from '@/components/features/LibraryStatsRow';
import { LibraryEmptyState } from '@/components/features/LibraryEmptyState';
import { usePlaylists, useLikedAlbums, useLikedArtists } from '@/hooks/useLibrary';
import { useUploads } from '@/hooks/useUploads';
import { useOnline } from '@/hooks/useOnline';
import { useOfflineHydration } from '@/hooks/useOfflineActions';
import { useOfflineStore } from '@/store/offline';
import { Button } from '@/components/ui/Button';
import { PageLoader } from '@/components/ui/PageLoader';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/Tabs';
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

function readStoredTab(): Tab | null {
  if (typeof sessionStorage === 'undefined') return null;
  try {
    const stored = sessionStorage.getItem(TAB_STORAGE_KEY);
    return isValidTab(stored) ? stored : null;
  } catch {
    // Private mode / disabled storage — silently fall back.
    return null;
  }
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

  // The active tab is DERIVED from the URL — the URL is the single
  // source of truth. Earlier we kept it in `useState` and ran two
  // separate `useEffect`s to mirror state ↔ URL, but the two effects
  // raced after the user clicked a tab: the "URL → state" mirror
  // would read the OLD `searchParams` (still ?tab=artists) on the
  // same render that the "state → URL" mirror was about to overwrite,
  // call `setTab('artists')`, and revert the user's click. The
  // user-visible symptom was "the Albums and Artists tabs feel sticky
  // — the page snaps back to them when I try to switch to anything
  // else". Deriving the tab eliminates the race entirely; React
  // Router's `searchParams` is itself the only piece of state.
  const urlTab = searchParams.get('tab');
  const tab: Tab = isValidTab(urlTab) ? urlTab : 'playlists';

  // Persist the active tab into `sessionStorage` so re-entering the
  // Library page from elsewhere (e.g. tapping the Library icon in
  // the bottom nav while we are already on `/library`) lands on the
  // user's last-viewed tab instead of the default. We write here
  // (not inside `setTab`) so deep-link arrivals like
  // `/library?tab=artists` also seed the cross-mount memory.
  useEffect(() => {
    if (typeof sessionStorage === 'undefined') return;
    try {
      sessionStorage.setItem(TAB_STORAGE_KEY, tab);
    } catch {
      /* private mode — non-fatal. */
    }
  }, [tab]);

  // First-mount restore: when the user lands on `/library` with no
  // `?tab=` query and `sessionStorage` remembers a non-default tab,
  // hop the URL to that tab so the rendered content matches what the
  // user was last looking at. Runs at most once per mount via
  // `restoredRef` so subsequent navigations to `/library` (without
  // a tab query) don't re-bounce — that path is for the user
  // explicitly leaving a tab.
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    if (urlTab !== null) return;
    const stored = readStoredTab();
    if (stored && stored !== 'playlists') {
      const next = new URLSearchParams(searchParams);
      next.set('tab', stored);
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Single writer: the only place that mutates the active tab. Goes
  // through the URL so the change is observable to the rest of the
  // app (back/forward stack, share sheet, deep-link copy).
  const setTab = useCallback(
    (newTab: Tab) => {
      const next = new URLSearchParams(searchParams);
      if (newTab === 'playlists') {
        // Default tab — keep the URL clean (`/library` with no
        // query). Avoids littering the address bar / share-sheet
        // copy with a redundant `?tab=playlists`.
        next.delete('tab');
      } else {
        next.set('tab', newTab);
      }
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  // When the device drops the network, the existing playlist / album /
  // artist queries either return stale data (if React Query had a
  // cache hit) or nothing at all. Filter both lists down to whatever
  // is in the offline cache so the user sees only the things that
  // will actually play.
  useOfflineHydration();
  const online = useOnline();
  const savedAlbumIds = useOfflineStore((s) => s.savedAlbumIds);
  const savedPlaylistIds = useOfflineStore((s) => s.savedPlaylistIds);
  const downloadedTracksCount = useOfflineStore((s) => s.savedTrackIds.size);

  const visiblePlaylists = online
    ? playlists ?? []
    : (playlists ?? []).filter((pl) => savedPlaylistIds.has(pl.id));
  const visibleAlbums = online
    ? albumsData?.items ?? []
    : (albumsData?.items ?? []).filter((al) => savedAlbumIds.has(al.id));
  const visibleArtists = artistsData?.items ?? [];

  // Pre-formatted summary line shown in the hero. Falls back to a
  // friendlier "ready to be filled" string when the user has nothing
  // saved at all — empty libraries shouldn't read as "0 of 0 of 0".
  const heroSummary = useMemo(() => {
    const parts: string[] = [];
    const pl = visiblePlaylists.length;
    const al = visibleAlbums.length;
    const ar = visibleArtists.length;
    if (pl > 0) parts.push(t('library.summaryPlaylists', { count: pl }));
    if (al > 0) parts.push(t('library.summaryAlbums', { count: al }));
    if (ar > 0) parts.push(t('library.summaryArtists', { count: ar }));
    if (parts.length === 0) return t('library.summaryEmpty');
    return parts.join(' · ');
  }, [visiblePlaylists.length, visibleAlbums.length, visibleArtists.length, t]);

  return (
    <AuthGuard>
      <div className="mx-auto flex max-w-6xl flex-col gap-6 p-4 sm:p-6 lg:p-10">
        <LibraryHero
          summary={heroSummary}
          showCreateAction={tab === 'playlists'}
          onCreatePlaylist={() => setShowCreate(true)}
        />

        <LibraryStatsRow
          playlistsCount={visiblePlaylists.length}
          albumsCount={visibleAlbums.length}
          artistsCount={visibleArtists.length}
          downloadedCount={downloadedTracksCount}
          activeTab={tab}
          onSelectTab={setTab}
        />

        <Tabs
          value={tab}
          onValueChange={(v) => setTab(v as Tab)}
          className="flex flex-col gap-6"
        >
          {/* Tour target sits on the tabs row — that's the actual feature
              the body copy is describing ("likes / playlists / history"),
              not the page heading. The row is horizontally scrollable
              on narrow viewports (mobile portrait, especially with the
              iPhone safe-area padding chewing into the visible width)
              the four chips wouldn't fit and the rightmost one
              ("Загруженное") got visually clipped by the page padding.
              `overflow-x-auto` + `shrink-0` on each chip lets the user
              swipe through them, while `[scrollbar-width:none]` keeps
              the scrollbar from looking like a dev-tool. */}
          <TabsList
            data-tour-id="tour-library"
            className="border-b border-border"
          >
            {tabs.map((tt) => (
              <TabsTrigger key={tt.key} value={tt.key}>
                {t(tt.labelKey)}
              </TabsTrigger>
            ))}
          </TabsList>

          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={tab}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
              className="flex flex-col gap-4"
            >
              {tab === 'playlists' && (
                <TabsContent value="playlists" forceMount>
                  <div className="flex flex-col gap-4">
                    <Link
                      to="/library/uploads"
                      className="group flex items-center gap-4 rounded-[var(--radius-md)] border border-border bg-card px-4 py-3 transition-all hover:border-[var(--color-border-strong)] hover:bg-secondary"
                    >
                      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[var(--radius-sm)] border border-border bg-background text-[var(--color-accent)] transition-transform group-hover:scale-105">
                        <UploadIcon size={18} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">
                          {t('library.uploadsEntry')}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {t('library.uploadsEntrySubtitle', {
                            count: uploads?.length ?? 0,
                            form: t(tracksFormKey(uploads?.length ?? 0)),
                          })}
                        </p>
                      </div>
                      <span className="hidden text-xs uppercase tracking-[0.2em] text-muted-foreground transition-colors group-hover:text-foreground sm:block">
                        {t('library.openCta')}
                      </span>
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
                      <LibraryEmptyState
                        icon={ListMusic}
                        title={t('library.emptyPlaylistsTitle')}
                        description={t('library.emptyPlaylistsDescription')}
                        action={
                          <Button
                            onClick={() => setShowCreate(true)}
                            variant="primary"
                            size="lg"
                          >
                            <Plus size={16} />
                            {t('library.newPlaylistShort')}
                          </Button>
                        }
                      />
                    )}
                  </div>
                </TabsContent>
              )}

              {tab === 'albums' && (
                <TabsContent value="albums" forceMount>
                  {visibleAlbums.length ? (
                    <motion.div
                      className="grid grid-cols-2 gap-5 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5"
                      initial="hidden"
                      animate="show"
                      variants={{
                        hidden: {},
                        show: { transition: { staggerChildren: 0.04 } },
                      }}
                    >
                      {visibleAlbums.map((album) => (
                        <motion.div
                          key={album.id}
                          variants={{
                            hidden: { opacity: 0, y: 12 },
                            show: { opacity: 1, y: 0 },
                          }}
                          transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
                        >
                          <AlbumCard
                            album={{
                              id: album.id,
                              title: album.title,
                              artist: album.artist,
                              artistId: album.artistId,
                              coverUrl: album.coverUrl,
                            }}
                          />
                        </motion.div>
                      ))}
                    </motion.div>
                  ) : (
                    <LibraryEmptyState
                      icon={Disc3}
                      title={t('library.noAlbumsTitle')}
                      description={t('library.emptyAlbumsDescription')}
                      action={
                        <p className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Heart size={12} />
                          {t('library.noAlbumsHint')}
                        </p>
                      }
                    />
                  )}
                </TabsContent>
              )}

              {tab === 'artists' && (
                <TabsContent value="artists" forceMount>
                  {visibleArtists.length ? (
                    <motion.div
                      className="grid grid-cols-2 gap-5 sm:grid-cols-3 md:grid-cols-5 xl:grid-cols-6"
                      initial="hidden"
                      animate="show"
                      variants={{
                        hidden: {},
                        show: { transition: { staggerChildren: 0.03 } },
                      }}
                    >
                      {visibleArtists.map((artist) => (
                        <motion.div
                          key={artist.id}
                          variants={{
                            hidden: { opacity: 0, y: 12 },
                            show: { opacity: 1, y: 0 },
                          }}
                          transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
                        >
                          <ArtistCard
                            artist={{
                              id: artist.id,
                              name: artist.name,
                              imageUrl: artist.imageUrl,
                            }}
                          />
                        </motion.div>
                      ))}
                    </motion.div>
                  ) : (
                    <LibraryEmptyState
                      icon={User}
                      title={t('library.noArtistsTitle')}
                      description={t('library.emptyArtistsDescription')}
                      action={
                        <p className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Sparkles size={12} />
                          {t('library.noArtistsHint')}
                        </p>
                      }
                    />
                  )}
                </TabsContent>
              )}

              {tab === 'downloaded' && (
                <TabsContent value="downloaded" forceMount>
                  <OfflineLibraryTab />
                </TabsContent>
              )}
            </motion.div>
          </AnimatePresence>
        </Tabs>

        <CreatePlaylistDialog open={showCreate} onClose={() => setShowCreate(false)} />
      </div>
    </AuthGuard>
  );
}
