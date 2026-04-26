import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Upload as UploadIcon } from 'lucide-react';
import { AuthGuard } from '@/components/features/AuthGuard';
import { PlaylistCard } from '@/components/features/PlaylistCard';
import { CreatePlaylistDialog } from '@/components/features/CreatePlaylistDialog';
import { usePlaylists } from '@/hooks/useLibrary';
import { useUploads } from '@/hooks/useUploads';
import { Button } from '@/components/ui/Button';

export function LibraryPage() {
  const { data: playlists, isLoading } = usePlaylists();
  const { data: uploads } = useUploads();
  const [showCreate, setShowCreate] = useState(false);

  return (
    <AuthGuard>
      <div className="mx-auto flex max-w-5xl flex-col gap-6 p-4 sm:p-6 lg:p-10">
        <div className="flex items-end justify-between gap-4 border-b border-border pb-4">
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium uppercase tracking-[0.25em] text-muted-foreground">
              Коллекция
            </span>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Библиотека</h1>
          </div>
          <Button onClick={() => setShowCreate(true)} variant="outline">
            <Plus size={14} />
            Плейлист
          </Button>
        </div>

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

        <CreatePlaylistDialog open={showCreate} onClose={() => setShowCreate(false)} />
      </div>
    </AuthGuard>
  );
}
