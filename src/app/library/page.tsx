import { useState } from 'react';
import { Plus } from 'lucide-react';
import { AuthGuard } from '@/components/features/AuthGuard';
import { PlaylistCard } from '@/components/features/PlaylistCard';
import { CreatePlaylistDialog } from '@/components/features/CreatePlaylistDialog';
import { usePlaylists } from '@/hooks/useLibrary';

export function LibraryPage() {
  const { data: playlists, isLoading } = usePlaylists();
  const [showCreate, setShowCreate] = useState(false);

  return (
    <AuthGuard>
      <div className="p-6 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Библиотека</h1>
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-medium"
            style={{ backgroundColor: 'var(--color-accent)', color: 'var(--color-text-on-accent)' }}
          >
            <Plus size={16} />
            Плейлист
          </button>
        </div>

        {isLoading ? (
          <p style={{ color: 'var(--color-text-muted)' }}>Загрузка...</p>
        ) : playlists?.length ? (
          <div className="flex flex-col gap-2">
            {playlists.map((pl) => (
              <PlaylistCard key={pl.id} playlist={pl} />
            ))}
          </div>
        ) : (
          <p style={{ color: 'var(--color-text-muted)' }}>
            У вас пока нет плейлистов
          </p>
        )}

        <CreatePlaylistDialog open={showCreate} onClose={() => setShowCreate(false)} />
      </div>
    </AuthGuard>
  );
}
