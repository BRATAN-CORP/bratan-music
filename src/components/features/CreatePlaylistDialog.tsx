import { useId, useState } from 'react';
import { Plus } from 'lucide-react';
import { useCreatePlaylist } from '@/hooks/useLibrary';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal, ModalHeader } from '@/components/ui/Modal';
import { useT } from '@/i18n';

interface CreatePlaylistDialogProps {
  open: boolean;
  onClose: () => void;
}

export function CreatePlaylistDialog({ open, onClose }: CreatePlaylistDialogProps) {
  const t = useT();
  const titleId = useId();
  const [name, setName] = useState('');
  const createPlaylist = useCreatePlaylist();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    await createPlaylist.mutateAsync(name.trim());
    setName('');
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} size="sm" labelledBy={titleId} panelClassName="p-6">
      <ModalHeader
        titleId={titleId}
        title={t('playlist.create_dialog.title')}
        onClose={onClose}
        closeAriaLabel={t('common.close')}
        className="mb-5"
      />
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <Input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('playlist.create_dialog.namePlaceholder')}
          autoFocus
        />
        <Button type="submit" disabled={!name.trim() || createPlaylist.isPending} className="w-full">
          <Plus size={14} />
          {createPlaylist.isPending ? t('playlist.create_dialog.submitting') : t('playlist.create_dialog.submit')}
        </Button>
      </form>
    </Modal>
  );
}
