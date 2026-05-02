import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ListMusic, Heart, MoreHorizontal, Trash2, Loader2, Pencil, Pin, PinOff } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import type { Playlist } from '@/types';
import { useDeletePlaylist, usePinPlaylist } from '@/hooks/useLibrary';
import { Button } from '@/components/ui/Button';
import { PopoverMenu } from '@/components/ui/PopoverMenu';
import { RenamePlaylistDialog } from './RenamePlaylistDialog';
import { useT } from '@/i18n';
import type { TranslationKey } from '@/i18n';

function tracksFormKey(count: number): TranslationKey {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return 'library.trackUnit1';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'library.trackUnit2_4';
  return 'library.trackUnit5plus';
}

interface PlaylistCardProps {
  playlist: Playlist;
}

export function PlaylistCard({ playlist }: PlaylistCardProps) {
  const t = useT();
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  const deletePlaylist = useDeletePlaylist();
  const pinPlaylist = usePinPlaylist();
  const isPinned = playlist.pinnedAt != null || playlist.isLiked;

  // Linked playlists (saved Tidal editorial / shared via link from another
  // user) live in the user's library as a *reference* row — the user
  // doesn't own the underlying tracks, so renaming and changing the cover
  // are not allowed (the backend rejects them too). Removing one only
  // deletes the local reference row, not the original.
  const isLinked = Boolean(playlist.sourceKind);
  const canEdit = !playlist.isLiked;
  const canRename = canEdit && !isLinked;
  const removeLabel = t(isLinked ? 'playlistCard.removeLinked' : 'playlistCard.remove');
  const confirmTitle = t(isLinked ? 'playlistCard.confirmTitleLinked' : 'playlistCard.confirmTitle');
  const confirmDescription = t(
    isLinked ? 'playlistCard.confirmDescriptionLinked' : 'playlistCard.confirmDescription',
    { name: playlist.name },
  );
  const confirmButtonLabel = t(isLinked ? 'playlistCard.confirmButtonLinked' : 'playlistCard.confirmButton');

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
          <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-[var(--radius-sm)] border border-border bg-background text-muted-foreground">
            {playlist.coverUrl ? (
              <img
                src={playlist.coverUrl}
                alt=""
                className="h-full w-full object-cover"
                aria-hidden
              />
            ) : playlist.isLiked ? (
              <Heart size={18} fill="currentColor" />
            ) : (
              <ListMusic size={18} />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{playlist.name}</p>
            <p className="text-xs text-muted-foreground">
              {t('playlistCard.tracksCount', {
                count: playlist.trackCount,
                form: t(tracksFormKey(playlist.trackCount)),
              })}
            </p>
          </div>
          {canEdit && (
            <>
              <button
                ref={menuTriggerRef}
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setMenuOpen((v) => !v);
                }}
                className="inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
                aria-label={t('playlistCard.actions')}
              >
                <MoreHorizontal size={16} />
              </button>
              <PopoverMenu
                open={menuOpen}
                onClose={() => setMenuOpen(false)}
                triggerRef={menuTriggerRef}
                anchor="bottom"
                align="end"
                width={192}
              >
                    {canRename && (
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
                        {t('playlistCard.rename')}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setMenuOpen(false);
                        pinPlaylist.mutate({ id: playlist.id, pinned: !isPinned });
                      }}
                      disabled={playlist.isLiked}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-all hover:bg-secondary active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {isPinned ? <PinOff size={14} /> : <Pin size={14} />}
                      {t(isPinned ? 'playlistCard.unpin' : 'playlistCard.pin')}
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
                      {removeLabel}
                    </button>
              </PopoverMenu>
            </>
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
            className="liquid-glass-scrim fixed inset-0 z-50 flex items-center justify-center p-4"
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
              className="liquid-glass w-full max-w-sm rounded-[var(--radius-lg)] p-5"
            >
              <h2 className="text-base font-semibold tracking-tight">{confirmTitle}</h2>
              <p className="mt-2 text-sm text-muted-foreground">{confirmDescription}</p>
              {deletePlaylist.isError && (
                <p className="mt-3 rounded-[var(--radius-sm)] bg-[var(--color-danger-muted)] px-3 py-2 text-xs text-[var(--color-danger)]">
                  {deletePlaylist.error instanceof Error ? deletePlaylist.error.message : t('common.error')}
                </p>
              )}
              <div className="mt-5 flex items-center justify-end gap-2">
                <Button
                  variant="ghost"
                  onClick={() => setConfirmOpen(false)}
                  disabled={deletePlaylist.isPending}
                >
                  {t('common.cancel')}
                </Button>
                <Button
                  variant="danger"
                  onClick={handleDelete}
                  disabled={deletePlaylist.isPending}
                >
                  {deletePlaylist.isPending ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                  {confirmButtonLabel}
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
