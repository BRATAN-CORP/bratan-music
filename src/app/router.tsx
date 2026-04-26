import { createBrowserRouter, RouterProvider, Outlet } from 'react-router-dom';
import { Header } from '@/components/layout/Header';
import { Sidebar } from '@/components/layout/Sidebar';
import { BottomNav } from '@/components/layout/BottomNav';
import { Player } from '@/components/layout/Player';
import { PageTransition } from '@/components/ui/PageTransition';
import { LandingPage } from '@/app/landing/page';
import { SearchPage } from '@/app/search/page';
import { LibraryPage } from '@/app/library/page';
import { ProfilePage } from '@/app/profile/page';
import { PlaylistPage } from '@/app/playlist/page';
import { TrackPage } from '@/app/track/page';
import { AlbumPage } from '@/app/album/page';
import { ArtistPage } from '@/app/artist/page';
import { NotFoundPage } from '@/app/not-found/page';

function AppLayout() {
  return (
    <div className="flex min-h-dvh flex-col">
      <Header />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <main className="flex-1 overflow-y-auto pb-44 lg:pb-32">
          <PageTransition>
            <Outlet />
          </PageTransition>
        </main>
      </div>
      <Player />
      <BottomNav />
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
