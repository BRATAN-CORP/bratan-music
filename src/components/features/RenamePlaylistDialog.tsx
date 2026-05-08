import { useEffect, useState } from 'react';
import { Loader2, Pencil } from 'lucide-react';
import { useRenamePlaylist } from '@/hooks/useLibrary';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal, ModalHeader } from '@/components/ui/Modal';
import { useT } from '@/i18n';

interface RenamePlaylistDialogProps {
  open: boolean;
  onClose: () => void;
  playlistId: string;
  initialName: string;
}

export function RenamePlaylistDialog({
  open, onClose, playlistId, initialName,
}: RenamePlaylistDialogProps) {
  const t = useT();
  const [name, setName] = useState(initialName);
  const rename = useRenamePlaylist();

  useEffect(() => {
    if (open) setName(initialName);
  }, [open, initialName]);

  const trimmed = name.trim();
  const unchanged = trimmed === initialName;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!trimmed || unchanged) return;
    await rename.mutateAsync({ id: playlistId, name: trimmed });
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      busy={rename.isPending}
      ariaLabel={t('playlist.rename_dialog.title')}
      panelClassName="p-6"
    >
      <ModalHeader
        title={t('playlist.rename_dialog.title')}
        onClose={onClose}
        closeAriaLabel={t('common.close')}
        className="mb-5"
      />
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('playlist.rename_dialog.placeholder')}
          autoFocus
          maxLength={120}
        />
        {rename.isError && (
          <p className="rounded-[var(--radius-sm)] bg-[var(--color-danger-muted)] px-3 py-2 text-xs text-[var(--color-danger)]">
            {rename.error instanceof Error ? rename.error.message : t('common.error')}
          </p>
        )}
        <Button
          type="submit"
          disabled={!trimmed || unchanged || rename.isPending}
          className="w-full"
        >
          {rename.isPending ? <Loader2 size={14} className="animate-spin" /> : <Pencil size={14} />}
          {rename.isPending ? t('playlist.rename_dialog.submitting') : t('playlist.rename_dialog.submit')}
        </Button>
      </form>
    </Modal>
  );
}
