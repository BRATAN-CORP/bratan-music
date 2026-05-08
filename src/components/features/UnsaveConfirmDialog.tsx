/**
 * Two-option destructive-confirm sheet for "untick the offline-save
 * checkmark" on an album or playlist. Without it, an accidental tap on
 * the saved-state button silently wipes every audio blob the user
 * spent their cellular budget downloading.
 *
 * The two options branch differently:
 *   - "Delete with tracks" — drops the album/playlist row AND every
 *     audio blob exclusively held by it.
 *   - "Keep tracks"        — drops only the album/playlist row but
 *     leaves audio blobs on disk so they remain playable from the
 *     library / saved-tracks views.
 *
 * Sits at `layer="confirm"` (z-[90]) so a stale "saved!" toast can't
 * occlude the destructive-action explanation.
 */
import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { Trash2, FolderMinus, Loader2 } from 'lucide-react';
import { Modal, ModalHeader } from '@/components/ui/Modal';
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
    <Modal
      open={open}
      onClose={onClose}
      busy={!!working}
      layer="confirm"
      size="md"
      labelledBy="unsave-dialog-title"
      panelClassName="p-6 shadow-[0_24px_64px_-24px_rgba(0,0,0,0.55)]"
    >
      <ModalHeader
        title={title}
        titleId="unsave-dialog-title"
        description={
          <>
            {itemTitle ? (
              <span className="block truncate text-xs text-muted-foreground">{itemTitle}</span>
            ) : null}
            <span className="mt-2 block text-sm text-muted-foreground">{description}</span>
          </>
        }
        onClose={onClose}
        closeAriaLabel={t('common.close')}
        className="mb-4"
      />

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
    </Modal>
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
