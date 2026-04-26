import { createBrowserRouter, RouterProvider, Outlet } from 'react-router-dom';
import { Header } from '@/components/layout/Header';
import { Sidebar } from '@/components/layout/Sidebar';
import { BottomNav } from '@/components/layout/BottomNav';
import { Player } from '@/components/layout/Player';
import { LandingPage } from '@/app/landing/page';
import { SearchPage } from '@/app/search/page';
import { LibraryPage } from '@/app/library/page';
import { ProfilePage } from '@/app/profile/page';

function AppLayout() {
  return (
    <div className="flex flex-col min-h-dvh">
      <Header />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <main className="flex-1 overflow-y-auto pb-36 lg:pb-24">
          <Outlet />
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
        { path: 'track/:id', element: <div>Трек</div> },
        { path: 'album/:id', element: <div>Альбом</div> },
        { path: 'artist/:id', element: <div>Артист</div> },
        { path: 'playlist/:id', element: <div>Плейлист</div> },
      ],
    },
  ],
  { basename: '/bratan-music' }
);

export function AppRouter() {
  return <RouterProvider router={router} />;
}
