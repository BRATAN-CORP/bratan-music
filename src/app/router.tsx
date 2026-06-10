import { useEffect } from 'react';
import { createBrowserRouter, RouterProvider, Outlet } from 'react-router-dom';
import { useAutoAuth } from '@/hooks/useAuth';
import { useSettingsSync } from '@/hooks/useSettingsSync';
import { useRoomBridge } from '@/hooks/useRoomBridge';
import { usePlayerStore } from '@/store/player';
import { Sidebar } from '@/components/layout/Sidebar';
import { MobileBottomDock } from '@/components/layout/MobileBottomDock';
import { QuickPrefsBar } from '@/components/layout/QuickPrefsBar';
import { Player } from '@/components/layout/Player';
import { FullscreenPlayer } from '@/components/layout/FullscreenPlayer';
import { PageTransition } from '@/components/ui/PageTransition';
import { SubscriptionDialog } from '@/components/features/SubscriptionDialog';
import { OnboardingTour } from '@/components/features/OnboardingTour';
import { RoomConnectedBadge } from '@/components/features/RoomConnectedBadge';
import { OfflineToastWatcher } from '@/components/features/OfflineToastWatcher';
import { AppUpdateWatcher } from '@/components/features/AppUpdateWatcher';
import { GlassFilter } from '@/components/ui/liquid-glass-button';
import { ToastHost } from '@/components/ui/ToastHost';
import { DislikesBootstrap } from '@/components/system/DislikesBootstrap';
import { LandingPage } from '@/app/landing/page';
import { HomePage } from '@/app/home/page';
import { useAuthStore } from '@/store/auth';
import { usePlayHistoryLogger } from '@/hooks/usePlayHistoryLogger';
import { Navigate } from 'react-router-dom';
import { SearchPage } from '@/app/search/page';
import { ExploreSlugPage } from '@/app/explore/slug';
import { ExploreListPage } from '@/app/explore/list';
import { TidalPlaylistPage } from '@/app/explore/playlist';
import { LibraryPage } from '@/app/library/page';
import { UploadsPage } from '@/app/library/uploads/page';
import { ImportPage } from '@/app/library/import/page';
import { DownloadedPlaylistPage } from '@/app/library/downloaded/page';
import { ProfilePage } from '@/app/profile/page';
import { AiPlaylistPage } from '@/app/ai/page';
import { DailyPlaylistPreviewPage } from '@/app/daily/page';
import { PlaylistPage } from '@/app/playlist/page';
import { SharedPlaylistPage } from '@/app/shared/page';
import { TrackPage } from '@/app/track/page';
import { AlbumPage } from '@/app/album/page';
import { ArtistPage } from '@/app/artist/page';
import { ArtistAlbumsPage, ArtistSinglesPage } from '@/app/artist/releases';
import { NotFoundPage } from '@/app/not-found/page';
import { RoomsListPage } from '@/app/rooms/list';
import { RoomPage } from '@/app/rooms/page';
import { EmailAuthPage } from '@/app/auth/email/page';

/** Default <title> baked into index.html. We snapshot it on first
 *  mount so we can restore it when nothing is playing — otherwise
 *  this would be a hard-coded string that drifts out of sync with
 *  the HTML if it's ever renamed. */
const DEFAULT_DOCUMENT_TITLE = typeof document !== 'undefined' ? document.title : '';

function useDocumentPlaybackTitle() {
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (isPlaying && currentTrack) {
      // "Artist — Track" while playing, default title otherwise.
      // Em-dash matches the existing index.html title style.
      const artist = currentTrack.artist?.trim();
      const title = currentTrack.title?.trim();
      document.title = artist ? `${artist} — ${title}` : (title || DEFAULT_DOCUMENT_TITLE);
    } else {
      document.title = DEFAULT_DOCUMENT_TITLE;
    }
  }, [isPlaying, currentTrack]);
  // Reset on unmount so a remount doesn't leave a stale title.
  useEffect(() => () => {
    if (typeof document !== 'undefined') document.title = DEFAULT_DOCUMENT_TITLE;
  }, []);
}

/**
 * Choose what `/` renders: signed-in users land on the personalised
 * HomePage (Моя волна + Плейлисты дня + Недавнее); anonymous visitors
 * still see the marketing LandingPage with the Telegram login CTA.
 *
 * Lives as a tiny indirection so the route table itself stays a flat
 * map of paths to elements; auth-gating is contained here instead of
 * sprinkled across pages.
 */
function HomeOrLanding() {
  const isAuthed = useAuthStore((s) => Boolean(s.user));
  return isAuthed ? <HomePage /> : <LandingPage />;
}

function AppLayout() {
  useAutoAuth();
  // Pull server-stored prefs (crossfade, EQ, etc.) on session start
  // and debounce-push local changes back. Mounted at the layout
  // level so it lives across the whole session.
  useSettingsSync();
  useDocumentPlaybackTitle();
  // Listening-history logger + auto-extend the queue when it nears
  // empty. Mounted at the layout level so it survives navigation
  // between routes — losing the in-flight track on every route change
  // would mean we under-log plays for users who navigate while a song
  // is still playing.
  usePlayHistoryLogger();
  // Listening-room bridge: while the user is connected to a room
  // (any non-null `roomConnection.roomId`), this synchronises the
  // global `<audio>` engine with the host's authoritative state —
  // pulling track / position / play-pause from the room and pushing
  // local control actions back. Mounted at the layout so the bridge
  // keeps working when the user navigates away from /rooms/:id.
  useRoomBridge();
  // Single-scroller layout: html/body owns the only vertical scroll. The
  // previous nested `main { overflow-y-auto }` inside `h-dvh + overflow-hidden`
  // shell created a SECOND scrollbar inside `main`, which made `position: fixed`
  // children (BottomNav, mobile mini-player) measure their right edge against
  // the viewport while content text edges measured against `main`'s narrower
  // content area — the bars ended up ~scrollbar_width past the grid on the
  // right while the left edges still aligned. With one scroller the grid and
  // fixed bars share the same right anchor (html's `scrollbar-gutter: stable`),
  // and Sidebar is parked sticky-below-Header so it still feels pinned.
  return (
    <div className="flex min-h-dvh flex-col">
      {/* Connectivity status is now driven through the global toast
          store (`OfflineToastWatcher`) instead of a sticky banner — the
          previous always-visible strip lived under the iPhone notch
          when the app was installed as a PWA, and the user can't
          read text that's behind the status bar. The toast surface
          announces transitions briefly and gets out of the way. */}
      <OfflineToastWatcher />
      {/* Detects new service-worker versions and pushes a toast with
          a "Reload" action so the user can pick up frontend updates
          on next launch without reinstalling the PWA. IndexedDB
          (offline tracks / metadata) is independent of the SW cache,
          so updating the frontend never deletes saved music. */}
      <AppUpdateWatcher />
      {/* Header has been retired — the desktop sidebar carries the
          brandmark + nav, and on mobile the bottom dock owns navigation.
          The previous sticky top bar duplicated the search affordance
          already in the sidebar / bottom dock and ate vertical space on
          short viewports. */}
      <div className="flex flex-1">
        <Sidebar />
        {/*
         * `pt-safe` adds an iOS-PWA notch / status-bar inset on top of
         * the existing page padding. The variable resolves to `0px`
         * inside Telegram WebApp and regular browser tabs (display-mode:
         * browser) so the layout stays byte-for-byte identical there;
         * it picks up `env(safe-area-inset-top)` only when launched as
         * a standalone PWA. See `globals.scss` for the variable
         * definition. This single hook covers every sub-page back
         * button, sticky header and hero gradient that currently
         * rendered under the iPhone notch when the app was installed.
         */}
        <main className="pt-safe min-w-0 flex-1 pb-44 lg:pb-32">
          <PageTransition>
            <Outlet />
          </PageTransition>
        </main>
      </div>
      <Player />
      <FullscreenPlayer />
      <MobileBottomDock />
      <SubscriptionDialog />
      <OnboardingTour />
      <RoomConnectedBadge />
      <QuickPrefsBar />
      <GlassFilter />
      <ToastHost />
      <DislikesBootstrap />
    </div>
  );
}

const router = createBrowserRouter(
  [
    {
      path: '/',
      element: <AppLayout />,
      children: [
        { index: true, element: <HomeOrLanding /> },
        { path: 'search', element: <SearchPage /> },
        // The user explicitly retired the standalone /explore landing —
        // its content lives inside SearchEmptyState now. We keep
        // /explore/:slug because individual genre pages are still
        // linked from the empty-state genre tiles. Anything hitting
        // bare /explore bounces back to /search where the discovery
        // surface now lives.
        { path: 'explore', element: <Navigate to="/search" replace /> },
        { path: 'explore/:slug', element: <ExploreSlugPage /> },
        { path: 'explore/:slug/list/:moduleIndex', element: <ExploreListPage /> },
        { path: 'explore/playlist/:uuid', element: <TidalPlaylistPage /> },
        { path: 'library', element: <LibraryPage /> },
        { path: 'library/uploads', element: <UploadsPage /> },
        { path: 'library/import', element: <ImportPage /> },
        { path: 'library/downloaded', element: <DownloadedPlaylistPage /> },
        { path: 'profile', element: <ProfilePage /> },
        { path: 'ai', element: <AiPlaylistPage /> },
        { path: 'daily/:id', element: <DailyPlaylistPreviewPage /> },
        { path: 'track/:id', element: <TrackPage /> },
        { path: 'album/:id', element: <AlbumPage /> },
        { path: 'artist/:id', element: <ArtistPage /> },
        { path: 'artist/:id/albums', element: <ArtistAlbumsPage /> },
        { path: 'artist/:id/singles', element: <ArtistSinglesPage /> },
        { path: 'playlist/:id', element: <PlaylistPage /> },
        { path: 'p/:token', element: <SharedPlaylistPage /> },
        { path: 'rooms', element: <RoomsListPage /> },
        { path: 'rooms/:id', element: <RoomPage /> },
        { path: 'auth/email', element: <EmailAuthPage /> },
        { path: '*', element: <NotFoundPage /> },
      ],
    },
  ],
  { basename: import.meta.env.BASE_URL.replace(/\/$/, '') || '/' }
);

export function AppRouter() {
  return <RouterProvider router={router} />;
}
