import { createBrowserRouter, RouterProvider, Outlet } from 'react-router-dom';
import { useAutoAuth } from '@/hooks/useAuth';
import { Sidebar } from '@/components/layout/Sidebar';
import { MobileBottomDock } from '@/components/layout/MobileBottomDock';
import { Player } from '@/components/layout/Player';
import { FullscreenPlayer } from '@/components/layout/FullscreenPlayer';
import { PageTransition } from '@/components/ui/PageTransition';
import { SubscriptionDialog } from '@/components/features/SubscriptionDialog';
import { GlassFilter } from '@/components/ui/liquid-glass-button';
import { LandingPage } from '@/app/landing/page';
import { Navigate } from 'react-router-dom';
import { SearchPage } from '@/app/search/page';
import { ExploreSlugPage } from '@/app/explore/slug';
import { TidalPlaylistPage } from '@/app/explore/playlist';
import { LibraryPage } from '@/app/library/page';
import { UploadsPage } from '@/app/library/uploads/page';
import { ProfilePage } from '@/app/profile/page';
import { PlaylistPage } from '@/app/playlist/page';
import { SharedPlaylistPage } from '@/app/shared/page';
import { TrackPage } from '@/app/track/page';
import { AlbumPage } from '@/app/album/page';
import { ArtistPage } from '@/app/artist/page';
import { NotFoundPage } from '@/app/not-found/page';

function AppLayout() {
  useAutoAuth();
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
      {/* Header has been retired — the desktop sidebar carries the
          brandmark + nav, and on mobile the bottom dock owns navigation.
          The previous sticky top bar duplicated the search affordance
          already in the sidebar / bottom dock and ate vertical space on
          short viewports. */}
      <div className="flex flex-1">
        <Sidebar />
        <main className="min-w-0 flex-1 pb-44 lg:pb-32">
          <PageTransition>
            <Outlet />
          </PageTransition>
        </main>
      </div>
      <Player />
      <FullscreenPlayer />
      <MobileBottomDock />
      <SubscriptionDialog />
      <GlassFilter />
    </div>
  );
}

const router = createBrowserRouter(
  [
    {
      path: '/',
      element: <AppLayout />,
      children: [
        { index: true, element: <LandingPage /> },
        { path: 'search', element: <SearchPage /> },
        // The user explicitly retired the standalone /explore landing —
        // its content lives inside SearchEmptyState now. We keep
        // /explore/:slug because individual genre pages are still
        // linked from the empty-state genre tiles. Anything hitting
        // bare /explore bounces back to /search where the discovery
        // surface now lives.
        { path: 'explore', element: <Navigate to="/search" replace /> },
        { path: 'explore/:slug', element: <ExploreSlugPage /> },
        { path: 'explore/playlist/:uuid', element: <TidalPlaylistPage /> },
        { path: 'library', element: <LibraryPage /> },
        { path: 'library/uploads', element: <UploadsPage /> },
        { path: 'profile', element: <ProfilePage /> },
        { path: 'track/:id', element: <TrackPage /> },
        { path: 'album/:id', element: <AlbumPage /> },
        { path: 'artist/:id', element: <ArtistPage /> },
        { path: 'playlist/:id', element: <PlaylistPage /> },
        { path: 'p/:token', element: <SharedPlaylistPage /> },
        { path: '*', element: <NotFoundPage /> },
      ],
    },
  ],
  { basename: '/bratan-music' }
);

export function AppRouter() {
  return <RouterProvider router={router} />;
}
