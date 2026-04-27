import { createBrowserRouter, RouterProvider, Outlet } from 'react-router-dom';
import { useAutoAuth } from '@/hooks/useAuth';
import { Header } from '@/components/layout/Header';
import { Sidebar } from '@/components/layout/Sidebar';
import { BottomNav } from '@/components/layout/BottomNav';
import { Player } from '@/components/layout/Player';
import { FullscreenPlayer } from '@/components/layout/FullscreenPlayer';
import { PageTransition } from '@/components/ui/PageTransition';
import { SubscriptionDialog } from '@/components/features/SubscriptionDialog';
import { LandingPage } from '@/app/landing/page';
import { SearchPage } from '@/app/search/page';
import { LibraryPage } from '@/app/library/page';
import { UploadsPage } from '@/app/library/uploads/page';
import { ProfilePage } from '@/app/profile/page';
import { PlaylistPage } from '@/app/playlist/page';
import { TrackPage } from '@/app/track/page';
import { AlbumPage } from '@/app/album/page';
import { ArtistPage } from '@/app/artist/page';
import { NotFoundPage } from '@/app/not-found/page';

function AppLayout() {
  useAutoAuth();
  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <Header />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <main className="min-w-0 flex-1 overflow-y-auto pb-44 lg:pb-32">
          <PageTransition>
            <Outlet />
          </PageTransition>
        </main>
      </div>
      <Player />
      <FullscreenPlayer />
      <BottomNav />
      <SubscriptionDialog />
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
        { path: 'library', element: <LibraryPage /> },
        { path: 'library/uploads', element: <UploadsPage /> },
        { path: 'profile', element: <ProfilePage /> },
        { path: 'track/:id', element: <TrackPage /> },
        { path: 'album/:id', element: <AlbumPage /> },
        { path: 'artist/:id', element: <ArtistPage /> },
        { path: 'playlist/:id', element: <PlaylistPage /> },
        { path: '*', element: <NotFoundPage /> },
      ],
    },
  ],
  { basename: '/bratan-music' }
);

export function AppRouter() {
  return <RouterProvider router={router} />;
}
