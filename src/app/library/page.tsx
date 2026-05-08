import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Plus, Upload as UploadIcon, Disc3, User, Heart } from 'lucide-react';
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from 'motion/react';
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
import { Eyebrow } from '@/components/ui/SectionHeading';
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
  const reduce = useReducedMotion();
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

  const visiblePlaylists = online
    ? playlists ?? []
    : (playlists ?? []).filter((pl) => savedPlaylistIds.has(pl.id));
  const visibleAlbums = online
    ? albumsData?.items ?? []
    : (albumsData?.items ?? []).filter((al) => savedAlbumIds.has(al.id));

  return (
    <AuthGuard>
      <div className="mx-auto flex max-w-6xl flex-col gap-6 p-4 sm:p-6 lg:p-10">
        {/* Hero header — soft accent radial behind so the page reads as
            part of the same family as /album, /artist, /playlist (whose
            <PageHero> uses the same accent-glow ambience). */}
        <section className="relative isolate -mx-4 overflow-hidden px-4 pb-5 pt-4 sm:-mx-6 sm:px-6 sm:pb-6 lg:-mx-10 lg:px-10">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(70%_120%_at_15%_0%,var(--color-accent-glow),transparent_70%)] opacity-50"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 bottom-0 -z-10 h-1/2 bg-gradient-to-b from-transparent to-[var(--color-bg)]"
          />
          <div className="flex items-end justify-between gap-4">
            <div className="flex flex-col gap-1">
              <Eyebrow>{t('library.collectionLabel')}</Eyebrow>
              <h1 className="text-2xl font-semibold tracking-tight sm:text-4xl">{t('library.title')}</h1>
            </div>
            {tab === 'playlists' && (
              <Button onClick={() => setShowCreate(true)} variant="outline">
                <Plus size={14} />
                {t('library.newPlaylistShort')}
              </Button>
            )}
          </div>
        </section>

        {/* Animated segmented tabs. The active pill uses motion's
            shared-layout (layoutId) so switching tabs slides the
            highlight smoothly between chips — same idiom as the
            profile language switcher, kept consistent across the
            app. `initial={false}` skips the first-mount slide so
            the highlight is in place when the user lands on the
            page. */}
        <LayoutGroup id="library-tabs">
          <div
            className="-mx-4 flex gap-1 overflow-x-auto border-b border-border px-4 pb-3 sm:-mx-6 sm:px-6 lg:-mx-10 lg:px-10 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            data-tour-id="tour-library"
          >
            {tabs.map((tt) => {
              const active = tab === tt.key;
              return (
                <button
                  key={tt.key}
                  type="button"
                  onClick={() => setTab(tt.key)}
                  className={`relative shrink-0 whitespace-nowrap rounded-full px-4 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
                    active ? 'text-background' : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
                  }`}
                  aria-pressed={active}
                >
                  {active && (
                    <motion.span
                      layoutId="library-tab-active"
                      initial={false}
                      className="absolute inset-0 rounded-full bg-foreground"
                      transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                      aria-hidden
                    />
                  )}
                  <span className="relative z-10">{t(tt.labelKey)}</span>
                </button>
              );
            })}
          </div>
        </LayoutGroup>

        {/* Tab content — fade-up on switch so swapping tabs feels
            connected, not abrupt. The 0.18s timing matches the rest
            of the motion vocabulary (tokens.scss `--motion-fast`). */}
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={tab}
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: -4 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            className="flex flex-col gap-5"
          >
            {tab === 'playlists' && (
              <>
                <Link
                  to="/library/uploads"
                  className="group flex items-center gap-4 rounded-[var(--radius-md)] border border-border bg-card px-4 py-3 transition-all hover:-translate-y-0.5 hover:border-border-strong hover:bg-secondary hover:shadow-[var(--shadow-sm)]"
                >
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[var(--radius-sm)] border border-border bg-background text-[var(--color-accent)] transition-colors group-hover:bg-[var(--color-accent-soft)]">
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
          </motion.div>
        </AnimatePresence>

        <CreatePlaylistDialog open={showCreate} onClose={() => setShowCreate(false)} />
      </div>
    </AuthGuard>
  );
}
