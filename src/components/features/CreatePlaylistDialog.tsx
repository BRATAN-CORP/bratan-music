import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { useCreatePlaylist } from '@/hooks/useLibrary';

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
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: 'var(--color-overlay)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm mx-4 p-6 rounded-2xl"
        style={{ backgroundColor: 'var(--color-surface)', boxShadow: 'var(--shadow-lg)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold">Новый плейлист</h2>
          <button onClick={onClose} className="p-1 hover:opacity-70">
            <X size={20} />
          </button>
        </div>
        <form onSubmit={handleSubmit}>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Название плейлиста"
            autoFocus
            className="w-full px-4 py-3 rounded-xl text-sm outline-none mb-4"
            style={{
              backgroundColor: 'var(--color-bg-subtle)',
              border: '1px solid var(--color-border)',
              color: 'var(--color-text)',
            }}
          />
          <button
            type="submit"
            disabled={!name.trim() || createPlaylist.isPending}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-medium disabled:opacity-50"
            style={{ backgroundColor: 'var(--color-accent)', color: 'var(--color-text-on-accent)' }}
          >
            <Plus size={16} />
            Создать
          </button>
        </form>
      </div>
    </div>
  );
}
