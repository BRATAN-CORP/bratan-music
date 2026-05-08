import { useEffect, useId, useState } from 'react';
import { ListMusic, Plus, X, Check, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import {
  useAddTrackToPlaylist,
  useCreatePlaylist,
  usePlaylistsList,
  type LikeableTrack,
} from '@/hooks/useLibrary';
import { useT } from '@/i18n';

interface AddToPlaylistDialogProps {
  open: boolean;
  onClose: () => void;
  track: LikeableTrack | null;
}

export function AddToPlaylistDialog({ open, onClose, track }: AddToPlaylistDialogProps) {
  const t = useT();
  const titleId = useId();
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

  const handleAdd = async (playlistId: string) => {
    if (!track) return;
    setErrorId(null);
    try {
      await addTrack.mutateAsync({ playlistId, track });
      setAddedId(playlistId);
      window.setTimeout(() => onClose(), 600);
    } catch (err) {
      const message = err instanceof Error ? err.message : t('common.error');
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
    <Modal
      open={open && !!track}
      onClose={onClose}
      align="sheet"
      labelledBy={titleId}
      panelClassName="max-w-[420px] flex flex-col rounded-[var(--radius-xl)] sm:rounded-[var(--radius-lg)] max-h-[calc(100dvh-7rem-var(--pwa-safe-bottom))]"
    >
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <ListMusic size={15} className="text-muted-foreground" />
          <span id={titleId} className="truncate text-sm font-medium">{t('playlist.add_dialog.title')}</span>
        </div>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose} aria-label={t('common.close')}>
          <X size={14} />
        </Button>
      </div>

      <div data-allow-pan-y className="min-h-0 flex-1 overflow-y-auto p-2">
        {isLoading ? (
          <div className="flex items-center justify-center gap-2 py-6 text-xs text-muted-foreground">
            <Loader2 size={14} className="animate-spin" /> {t('common.loading')}
          </div>
        ) : !playlists || playlists.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs text-muted-foreground">
            {t('playlist.add_dialog.empty')}
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
                    className="flex w-full items-center justify-between gap-3 rounded-[var(--radius-md)] px-3 py-2.5 text-left text-sm transition-colors hover:bg-[var(--color-hover-overlay-strong)] focus-visible:bg-[var(--color-hover-overlay-strong)] focus-visible:outline-none disabled:opacity-70"
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
                            : t('library.tracks', { count: p.trackCount })}
                        </span>
                      </div>
                    </div>
                    {isAdded ? (
                      <span className="inline-flex items-center gap-1 text-xs">
                        <Check size={14} /> {t('playlist.add_dialog.added')}
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
              placeholder={t('playlist.create_dialog.namePlaceholder')}
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
              {t('playlist.create_dialog.submit')}
            </Button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            className="flex w-full items-center justify-center gap-2 rounded-[var(--radius-md)] border border-dashed border-border px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:border-[var(--color-border-strong)] hover:text-foreground"
          >
            <Plus size={13} /> {t('playlist.add_dialog.createNew')}
          </button>
        )}
      </div>
    </Modal>
  );
}
