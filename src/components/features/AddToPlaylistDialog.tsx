import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ListMusic, Plus, X, Check, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import {
  useAddTrackToPlaylist,
  useCreatePlaylist,
  usePlaylistsList,
  type LikeableTrack,
} from '@/hooks/useLibrary';

interface AddToPlaylistDialogProps {
  open: boolean;
  onClose: () => void;
  track: LikeableTrack | null;
}

export function AddToPlaylistDialog({ open, onClose, track }: AddToPlaylistDialogProps) {
  const { data: allPlaylists, isLoading } = usePlaylistsList();
  // Hide the system "Liked" playlist from the picker. Adding to liked is
  // already exposed everywhere as a heart button; the dialog is for real
  // user-created playlists.
  const playlists = allPlaylists?.filter((p) => !p.isLiked);
  const addTrack = useAddTrackToPlaylist();
  const createPlaylist = useCreatePlaylist();
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [addedId, setAddedId] = useState<string | null>(null);
  const [errorId, setErrorId] = useState<{ id: string; message: string } | null>(null);

  useEffect(() => {
    if (!open) {
      setShowCreate(false);
      setName('');
      setAddedId(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const handleAdd = async (playlistId: string) => {
    if (!track) return;
    setErrorId(null);
    try {
      await addTrack.mutateAsync({ playlistId, track });
      setAddedId(playlistId);
      window.setTimeout(() => onClose(), 600);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка';
      setErrorId({ id: playlistId, message });
    }
  };

  const handleCreate = async () => {
    const trimmed = name.trim();
    if (!trimmed || !track) return;
    try {
      const created = await createPlaylist.mutateAsync(trimmed);
      await addTrack.mutateAsync({ playlistId: created.id, track });
      setAddedId(created.id);
      window.setTimeout(() => onClose(), 600);
    } catch {
      // ignore
    }
  };

  return (
    <AnimatePresence>
      {open && track && (
        <>
          <motion.div
            key="atp-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            onClick={onClose}
            className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm"
            aria-hidden
          />
          <motion.div
            key="atp-panel"
            role="dialog"
            aria-modal="true"
            aria-label="Добавить в плейлист"
            initial={{ opacity: 0, y: 24, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 24, scale: 0.97, transition: { duration: 0.18 } }}
            transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
            className="fixed left-1/2 top-1/2 z-[60] w-[min(420px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-[var(--radius-lg)] border border-border bg-[var(--color-surface-elevated)] shadow-[var(--shadow-xl)] backdrop-blur"
          >
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <div className="flex min-w-0 items-center gap-2">
                <ListMusic size={15} className="text-muted-foreground" />
                <span className="truncate text-sm font-medium">Добавить в плейлист</span>
              </div>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose} aria-label="Закрыть">
                <X size={14} />
              </Button>
            </div>

            <div className="max-h-[50vh] overflow-y-auto p-2">
              {isLoading ? (
                <div className="flex items-center justify-center gap-2 py-6 text-xs text-muted-foreground">
                  <Loader2 size={14} className="animate-spin" /> Загрузка...
                </div>
              ) : !playlists || playlists.length === 0 ? (
                <p className="px-3 py-6 text-center text-xs text-muted-foreground">
                  У вас пока нет плейлистов
                </p>
              ) : (
                <ul className="flex flex-col">
                  {playlists.map((p) => {
                    const isAdded = addedId === p.id;
                    return (
                      <li key={p.id}>
                        <button
                          type="button"
                          onClick={() => handleAdd(p.id)}
                          disabled={addTrack.isPending || isAdded}
                          className="flex w-full items-center justify-between gap-3 rounded-[var(--radius-md)] px-3 py-2.5 text-left text-sm transition-colors hover:bg-secondary disabled:opacity-70"
                        >
                          <div className="flex min-w-0 items-center gap-2.5">
                            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-sm)] border border-border bg-card text-muted-foreground">
                              <ListMusic size={14} />
                            </span>
                            <div className="flex min-w-0 flex-col">
                              <span className="truncate font-medium">{p.name}</span>
                              <span className="text-[11px] text-muted-foreground">
                                {errorId?.id === p.id
                                  ? errorId.message
                                  : `${p.trackCount} ${p.trackCount === 1 ? 'трек' : 'треков'}`}
                              </span>
                            </div>
                          </div>
                          {isAdded ? (
                            <span className="inline-flex items-center gap-1 text-xs">
                              <Check size={14} /> Добавлено
                            </span>
                          ) : (
                            <Plus size={14} className="text-muted-foreground" />
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <div className="border-t border-border p-3">
              {showCreate ? (
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    autoFocus
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleCreate();
                      if (e.key === 'Escape') setShowCreate(false);
                    }}
                    placeholder="Название плейлиста"
                    className="flex-1 rounded-[var(--radius-md)] border border-border bg-card px-3 py-2 text-sm outline-none focus:border-[var(--color-border-strong)]"
                  />
                  <Button
                    size="sm"
                    onClick={handleCreate}
                    disabled={!name.trim() || createPlaylist.isPending || addTrack.isPending}
                  >
                    {createPlaylist.isPending || addTrack.isPending ? (
                      <Loader2 size={12} className="animate-spin" />
                    ) : (
                      <Plus size={12} />
                    )}
                    Создать
                  </Button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowCreate(true)}
                  className="flex w-full items-center justify-center gap-2 rounded-[var(--radius-md)] border border-dashed border-border px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:border-[var(--color-border-strong)] hover:text-foreground"
                >
                  <Plus size={13} /> Новый плейлист
                </button>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
