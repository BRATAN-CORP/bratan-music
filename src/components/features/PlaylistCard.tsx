import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ListMusic, Heart, MoreHorizontal, Trash2, Loader2, Pencil } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import type { Playlist } from '@/types';
import { useDeletePlaylist } from '@/hooks/useLibrary';
import { Button } from '@/components/ui/Button';
import { RenamePlaylistDialog } from './RenamePlaylistDialog';

interface PlaylistCardProps {
  playlist: Playlist;
}

export function PlaylistCard({ playlist }: PlaylistCardProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const deletePlaylist = useDeletePlaylist();

  useEffect(() => {
    if (!menuOpen) return;
    const onClick = (e: Event) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('touchstart', onClick);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('touchstart', onClick);
    };
  }, [menuOpen]);

  const canEdit = !playlist.isLiked;

  const handleDelete = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      await deletePlaylist.mutateAsync(playlist.id);
      setConfirmOpen(false);
    } catch {
      // mutation surfaces error via state; keep modal open
    }
  };

  return (
    <>
      <div className="relative">
        <Link
          to={`/playlist/${playlist.id}`}
          className="flex items-center gap-4 border border-border bg-card px-4 py-3 transition-colors hover:bg-secondary rounded-[var(--radius-md)]"
        >
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[var(--radius-sm)] border border-border bg-background text-muted-foreground">
            {playlist.isLiked ? <Heart size={18} fill="currentColor" /> : <ListMusic size={18} />}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{playlist.name}</p>
            <p className="text-xs text-muted-foreground">
              {playlist.trackCount} {playlist.trackCount === 1 ? 'трек' : 'треков'}
            </p>
          </div>
          {canEdit && (
            <div ref={menuRef} className="relative">
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setMenuOpen((v) => !v);
                }}
                className="inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
                aria-label="Действия"
              >
                <MoreHorizontal size={16} />
              </button>
              <AnimatePresence>
                {menuOpen && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.96, y: -4 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.96, y: -4 }}
                    transition={{ duration: 0.12, ease: [0.16, 1, 0.3, 1] }}
                    className="absolute right-0 top-9 z-20 w-48 overflow-hidden rounded-[var(--radius-md)] border border-border bg-card shadow-[var(--shadow-lg)]"
                  >
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setMenuOpen(false);
                        setRenameOpen(true);
                      }}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-secondary"
                    >
                      <Pencil size={14} />
                      Переименовать
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setMenuOpen(false);
                        setConfirmOpen(true);
                      }}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-[var(--color-danger)] transition-colors hover:bg-[var(--color-danger-muted)]"
                    >
                      <Trash2 size={14} />
                      Удалить плейлист
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}
        </Link>
      </div>

      <RenamePlaylistDialog
        open={renameOpen}
        onClose={() => setRenameOpen(false)}
        playlistId={playlist.id}
        initialName={playlist.name}
      />

      <AnimatePresence>
        {confirmOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            style={{ backgroundColor: 'var(--color-overlay)' }}
            onClick={() => !deletePlaylist.isPending && setConfirmOpen(false)}
            role="dialog"
            aria-modal="true"
          >
            <motion.div
              initial={{ scale: 0.94, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.94, opacity: 0 }}
              transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-sm rounded-[var(--radius-md)] border border-border bg-card p-5 shadow-[var(--shadow-lg)]"
            >
              <h2 className="text-base font-semibold tracking-tight">Удалить плейлист?</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                «{playlist.name}» будет удалён вместе со всеми треками. Это действие необратимо.
              </p>
              {deletePlaylist.isError && (
                <p className="mt-3 rounded-[var(--radius-sm)] bg-[var(--color-danger-muted)] px-3 py-2 text-xs text-[var(--color-danger)]">
                  {deletePlaylist.error instanceof Error ? deletePlaylist.error.message : 'Ошибка'}
                </p>
              )}
              <div className="mt-5 flex items-center justify-end gap-2">
                <Button
                  variant="ghost"
                  onClick={() => setConfirmOpen(false)}
                  disabled={deletePlaylist.isPending}
                >
                  Отмена
                </Button>
                <Button
                  variant="danger"
                  onClick={handleDelete}
                  disabled={deletePlaylist.isPending}
                >
                  {deletePlaylist.isPending ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                  Удалить
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
