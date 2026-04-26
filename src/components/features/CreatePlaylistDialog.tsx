import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { useCreatePlaylist } from '@/hooks/useLibrary';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';

interface CreatePlaylistDialogProps {
  open: boolean;
  onClose: () => void;
}

export function CreatePlaylistDialog({ open, onClose }: CreatePlaylistDialogProps) {
  const [name, setName] = useState('');
  const createPlaylist = useCreatePlaylist();

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    await createPlaylist.mutateAsync(name.trim());
    setName('');
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'var(--color-overlay)' }}
      onClick={onClose}
      role="dialog"
    >
      <div
        className="w-full max-w-sm rounded-[var(--radius-md)] border border-border bg-card p-6 shadow-[var(--shadow-lg)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-base font-semibold tracking-tight">Новый плейлист</h2>
          <Button onClick={onClose} variant="ghost" size="icon" className="h-8 w-8" aria-label="Закрыть">
            <X size={16} />
          </Button>
        </div>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <Input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Название плейлиста"
            autoFocus
          />
          <Button type="submit" disabled={!name.trim() || createPlaylist.isPending} className="w-full">
            <Plus size={14} />
            Создать
          </Button>
        </form>
      </div>
    </div>
  );
}
