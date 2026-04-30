import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Upload as UploadIcon, Disc3, User, Heart } from 'lucide-react';
import { AuthGuard } from '@/components/features/AuthGuard';
import { PlaylistCard } from '@/components/features/PlaylistCard';
import { AlbumCard } from '@/components/features/AlbumCard';
import { ArtistCard } from '@/components/features/ArtistCard';
import { CreatePlaylistDialog } from '@/components/features/CreatePlaylistDialog';
import { usePlaylists, useLikedAlbums, useLikedArtists } from '@/hooks/useLibrary';
import { useUploads } from '@/hooks/useUploads';
import { Button } from '@/components/ui/Button';

type Tab = 'playlists' | 'albums' | 'artists';

const tabs: { key: Tab; label: string }[] = [
  { key: 'playlists', label: 'Плейлисты' },
  { key: 'albums', label: 'Альбомы' },
  { key: 'artists', label: 'Артисты' },
];

export function LibraryPage() {
  const { data: playlists, isLoading } = usePlaylists();
  const { data: uploads } = useUploads();
  const { data: albumsData } = useLikedAlbums();
  const { data: artistsData } = useLikedArtists();
  const [showCreate, setShowCreate] = useState(false);
  const [tab, setTab] = useState<Tab>('playlists');

  return (
    <AuthGuard>
      <div className="mx-auto flex max-w-6xl flex-col gap-6 p-4 sm:p-6 lg:p-10">
        <div className="flex items-end justify-between gap-4 border-b border-border pb-4">
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium uppercase tracking-[0.25em] text-muted-foreground">
              Коллекция
            </span>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Библиотека</h1>
          </div>
          {tab === 'playlists' && (
            <Button onClick={() => setShowCreate(true)} variant="outline">
              <Plus size={14} />
              Плейлист
            </Button>
          )}
        </div>

        <div className="flex gap-2 border-b border-border pb-3">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                tab === t.key
                  ? 'bg-foreground text-background'
                  : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
              }`}
            >
              {t.label}
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
                <p className="truncate text-sm font-medium">Загруженные</p>
                <p className="text-xs text-muted-foreground">
                  {uploads?.length ?? 0} {(uploads?.length ?? 0) === 1 ? 'трек' : 'треков'} · ваши файлы
                </p>
              </div>
            </Link>

            {isLoading ? (
              <p className="text-sm text-muted-foreground">Загрузка...</p>
            ) : playlists?.length ? (
              <div className="flex flex-col gap-2">
                {playlists.map((pl) => (
                  <PlaylistCard key={pl.id} playlist={pl} />
                ))}
              </div>
            ) : (
              <div className="rounded-[var(--radius-md)] border border-border bg-card py-12 text-center text-sm text-muted-foreground">
                У вас пока нет плейлистов
              </div>
            )}
          </>
        )}

        {tab === 'albums' && (
          <>
            {albumsData?.items?.length ? (
              <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
                {albumsData.items.map((album) => (
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
                  Нет сохранённых альбомов
                </p>
                <p className="text-xs text-muted-foreground">
                  Нажмите <Heart size={12} className="mb-0.5 inline" /> на странице альбома
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
                  Нет сохранённых артистов
                </p>
                <p className="text-xs text-muted-foreground">
                  Нажмите <Heart size={12} className="mb-0.5 inline" /> на странице артиста
                </p>
              </div>
            )}
          </>
        )}

        <CreatePlaylistDialog open={showCreate} onClose={() => setShowCreate(false)} />
      </div>
    </AuthGuard>
  );
}
