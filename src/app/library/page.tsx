import { useState } from 'react';
import { Plus } from 'lucide-react';
import { AuthGuard } from '@/components/features/AuthGuard';
import { PlaylistCard } from '@/components/features/PlaylistCard';
import { CreatePlaylistDialog } from '@/components/features/CreatePlaylistDialog';
import { usePlaylists } from '@/hooks/useLibrary';
import { Button } from '@/components/ui/Button';
import { Card, CardContent } from '@/components/ui/Card';

export function LibraryPage() {
  const { data: playlists, isLoading } = usePlaylists();
  const [showCreate, setShowCreate] = useState(false);

  return (
    <AuthGuard>
      <div className="mx-auto flex max-w-5xl flex-col gap-6 p-4 sm:p-6 lg:p-8">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.24em] text-primary">Коллекция</p>
            <h1 className="hero-gradient-text text-4xl font-black">Библиотека</h1>
          </div>
          <Button onClick={() => setShowCreate(true)}>
            <Plus size={16} />
            Плейлист
          </Button>
        </div>

        {isLoading ? (
          <p className="text-muted-foreground">Загрузка...</p>
        ) : playlists?.length ? (
          <div className="flex flex-col gap-2">
            {playlists.map((pl) => (
              <PlaylistCard key={pl.id} playlist={pl} />
            ))}
          </div>
        ) : (
          <Card className="animate-enter bg-card/70">
            <CardContent className="py-12 text-center text-muted-foreground">
              У вас пока нет плейлистов
            </CardContent>
          </Card>
        )}

        <CreatePlaylistDialog open={showCreate} onClose={() => setShowCreate(false)} />
      </div>
    </AuthGuard>
  );
}
