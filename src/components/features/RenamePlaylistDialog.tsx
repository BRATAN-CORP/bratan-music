import { useEffect, useState } from 'react';
import { Loader2, Pencil, X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useRenamePlaylist } from '@/hooks/useLibrary';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';

interface RenamePlaylistDialogProps {
  open: boolean;
  onClose: () => void;
  playlistId: string;
  initialName: string;
}

export function RenamePlaylistDialog({
  open, onClose, playlistId, initialName,
}: RenamePlaylistDialogProps) {
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
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="liquid-glass-scrim fixed inset-0 z-50 flex items-center justify-center p-4"
          onClick={() => !rename.isPending && onClose()}
          role="dialog"
          aria-modal="true"
        >
          <motion.div
            initial={{ scale: 0.94, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.94, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className="liquid-glass w-full max-w-sm rounded-[var(--radius-lg)] p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-base font-semibold tracking-tight">Переименовать плейлист</h2>
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
                maxLength={120}
              />
              {rename.isError && (
                <p className="rounded-[var(--radius-sm)] bg-[var(--color-danger-muted)] px-3 py-2 text-xs text-[var(--color-danger)]">
                  {rename.error instanceof Error ? rename.error.message : 'Ошибка'}
                </p>
              )}
              <Button
                type="submit"
                disabled={!trimmed || unchanged || rename.isPending}
                className="w-full"
              >
                {rename.isPending ? <Loader2 size={14} className="animate-spin" /> : <Pencil size={14} />}
                Сохранить
              </Button>
            </form>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
