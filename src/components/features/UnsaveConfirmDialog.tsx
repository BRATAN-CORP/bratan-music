/**
 * Two-option destructive-confirm sheet for "untick the offline-save
 * checkmark" on an album or playlist. Without it, an accidental tap on
 * the saved-state button silently wipes every audio blob the user
 * spent their cellular budget downloading — bug report #2 in the
 * offline-storage thread.
 *
 * The two options branch differently:
 *   - "Delete with tracks" → drops the album/playlist row AND every
 *     audio blob exclusively held by it. Used when the user is
 *     genuinely uninterested in the content.
 *   - "Keep tracks"        → drops only the album/playlist row but
 *     leaves the audio blobs on disk so they remain playable from
 *     the library / saved-tracks views. Surfaced because the most
 *     common reason for unsaving a playlist is that the user
 *     reorganised their library, not that they want to free space.
 *
 * Glass + motion styling matches `CreatePlaylistDialog` for visual
 * consistency. The sheet is rendered into the normal React tree
 * (no portal) since the parent surfaces — album / playlist hero —
 * already sit at z-index 0 and there's no overflow:hidden ancestor
 * that would clip the scrim.
 */
import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Trash2, X, FolderMinus, Loader2 } from 'lucide-react';
import { useT } from '@/i18n';

export type UnsaveTarget = 'album' | 'playlist';
export type UnsaveChoice = 'deleteAll' | 'keepTracks';

interface UnsaveConfirmDialogProps {
  open: boolean;
  target: UnsaveTarget;
  /** Title of the album / playlist being unsaved, shown in the
   *  dialog body so the user can sanity-check they're acting on
   *  the right item. Optional because some surfaces don't have it
   *  to hand (e.g. a library row with only id). */
  itemTitle?: string;
  onConfirm: (choice: UnsaveChoice) => Promise<void> | void;
  onClose: () => void;
}

export function UnsaveConfirmDialog({
  open,
  target,
  itemTitle,
  onConfirm,
  onClose,
}: UnsaveConfirmDialogProps) {
  const t = useT();
  // `working` covers the brief async window between user click and
  // the parent's IDB writes settling. We disable both buttons during
  // it so a panicky double-tap doesn't fire `onConfirm` twice.
  const [working, setWorking] = useState<UnsaveChoice | null>(null);

  // Reset the in-flight gate whenever the sheet opens — without this
  // a previous attempt that errored out would leave the buttons
  // permanently disabled the next time the dialog is shown.
  useEffect(() => {
    if (open) setWorking(null);
  }, [open]);

  // Esc-to-close affordance. Body of the handler is a no-op while a
  // confirm is in flight to match the disabled-button gate.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !working) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, working, onClose]);

  const handle = async (choice: UnsaveChoice) => {
    if (working) return;
    setWorking(choice);
    try {
      await onConfirm(choice);
      onClose();
    } finally {
      setWorking(null);
    }
  };

  const title = target === 'album'
    ? t('offline.unsaveAlbumTitle')
    : t('offline.unsavePlaylistTitle');
  const description = t('offline.unsaveDescription');
  const deleteAllDescription = target === 'album'
    ? t('offline.unsaveOptionDeleteAllAlbumDescription')
    : t('offline.unsaveOptionDeleteAllPlaylistDescription');
  const keepTracksDescription = target === 'album'
    ? t('offline.unsaveOptionKeepTracksAlbumDescription')
    : t('offline.unsaveOptionKeepTracksPlaylistDescription');

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="scrim"
          className="liquid-glass-scrim fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          onClick={() => { if (!working) onClose(); }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="unsave-dialog-title"
        >
          <motion.div
            key="sheet"
            className="liquid-glass w-full max-w-md rounded-[var(--radius-lg)] p-6"
            initial={{ opacity: 0, y: 24, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 24, scale: 0.96 }}
            transition={{ type: 'spring', stiffness: 380, damping: 32 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h2 id="unsave-dialog-title" className="text-base font-semibold tracking-tight">
                  {title}
                </h2>
                {itemTitle ? (
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">{itemTitle}</p>
                ) : null}
                <p className="mt-2 text-sm text-muted-foreground">{description}</p>
              </div>
              <button
                type="button"
                onClick={onClose}
                disabled={!!working}
                aria-label={t('common.close')}
                className="-mr-1 -mt-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-40"
              >
                <X size={16} />
              </button>
            </div>

            <div className="flex flex-col gap-2">
              <DialogChoiceButton
                accent="destructive"
                icon={<Trash2 size={18} />}
                label={t('offline.unsaveOptionDeleteAll')}
                description={deleteAllDescription}
                pending={working === 'deleteAll'}
                disabled={!!working}
                onClick={() => void handle('deleteAll')}
              />
              <DialogChoiceButton
                accent="neutral"
                icon={<FolderMinus size={18} />}
                label={t('offline.unsaveOptionKeepTracks')}
                description={keepTracksDescription}
                pending={working === 'keepTracks'}
                disabled={!!working}
                onClick={() => void handle('keepTracks')}
              />
            </div>

            <button
              type="button"
              onClick={onClose}
              disabled={!!working}
              className="mt-4 inline-flex w-full items-center justify-center rounded-[var(--radius-md)] border border-border bg-transparent px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-40"
            >
              {t('offline.unsaveCancel')}
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

interface DialogChoiceButtonProps {
  accent: 'destructive' | 'neutral';
  icon: React.ReactNode;
  label: string;
  description: string;
  pending: boolean;
  disabled: boolean;
  onClick: () => void;
}

function DialogChoiceButton({
  accent,
  icon,
  label,
  description,
  pending,
  disabled,
  onClick,
}: DialogChoiceButtonProps) {
  const accentClasses = accent === 'destructive'
    ? 'border-destructive/30 bg-destructive/5 hover:bg-destructive/10 text-destructive'
    : 'border-border bg-secondary/40 hover:bg-secondary text-foreground';
  return (
    <motion.button
      type="button"
      onClick={onClick}
      disabled={disabled}
      whileTap={{ scale: 0.985 }}
      transition={{ type: 'spring', stiffness: 400, damping: 24 }}
      className={`group flex w-full items-start gap-3 rounded-[var(--radius-md)] border px-4 py-3 text-left transition-all disabled:cursor-not-allowed disabled:opacity-60 ${accentClasses}`}
    >
      <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-current/10">
        {pending ? <Loader2 className="animate-spin" size={18} /> : icon}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-sm font-semibold leading-tight">{label}</span>
        <span className={`mt-0.5 text-xs leading-snug ${accent === 'destructive' ? 'text-destructive/80' : 'text-muted-foreground'}`}>
          {description}
        </span>
      </span>
    </motion.button>
  );
}
