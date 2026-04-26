import { useState } from 'react';
import { Plus } from 'lucide-react';
import { AuthGuard } from '@/components/features/AuthGuard';
import { PlaylistCard } from '@/components/features/PlaylistCard';
import { CreatePlaylistDialog } from '@/components/features/CreatePlaylistDialog';
import { usePlaylists } from '@/hooks/useLibrary';
import { Button } from '@/components/ui/Button';

export function LibraryPage() {
  const { data: playlists, isLoading } = usePlaylists();
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
