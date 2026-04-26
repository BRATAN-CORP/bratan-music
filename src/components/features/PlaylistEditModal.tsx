import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Image as ImageIcon, Trash2, Loader2, Check } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useAuthStore } from '@/store/auth';
import { API_BASE } from '@/lib/api';
import { useRenamePlaylist, useDeletePlaylistCover } from '@/hooks/useLibrary';
import type { Playlist } from '@/types';

interface PlaylistEditModalProps {
  open: boolean;
  onClose: () => void;
  playlist: Playlist;
}

const COVER_MAX_BYTES = 2 * 1024 * 1024;
const COVER_ACCEPT = 'image/jpeg,image/png,image/webp,image/gif';

export function PlaylistEditModal({ open, onClose, playlist }: PlaylistEditModalProps) {
  const [name, setName] = useState(playlist.name);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [renamed, setRenamed] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const token = useAuthStore((s) => s.accessToken);
  const renameMutation = useRenamePlaylist();
  const deleteCoverMutation = useDeletePlaylistCover();

  useEffect(() => {
    if (!open) return;
    setName(playlist.name);
    setError(null);
    setRenamed(false);
  }, [open, playlist.name]);

  if (!open) return null;

  const handleRename = async () => {
    const trimmed = name.trim();
    if (!trimmed || trimmed === playlist.name) return;
    setError(null);
    try {
      await renameMutation.mutateAsync({ id: playlist.id, name: trimmed });
      setRenamed(true);
      setTimeout(() => setRenamed(false), 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось переименовать');
    }
  };

  const handleUpload = async (file: File) => {
    if (file.size > COVER_MAX_BYTES) {
      setError('Файл слишком большой (макс. 2 МБ)');
      return;
    }
    setError(null);
    setUploading(true);
    try {
      const res = await fetch(`${API_BASE}/playlists/${playlist.id}/cover`, {
        method: 'PUT',
        headers: {
          'Content-Type': file.type,
          'Content-Length': String(file.size),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: file,
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? 'Не удалось загрузить обложку');
      }
      // Force a refresh of playlist queries by hitting the rename invalidation
      // path with the same name (no-op rename) — cleaner than wiring another
      // hook just to invalidate.
      await renameMutation.mutateAsync({ id: playlist.id, name: playlist.name });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка');
    } finally {
      setUploading(false);
    }
  };

  const handleDeleteCover = async () => {
    setError(null);
    try {
      await deleteCoverMutation.mutateAsync(playlist.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось удалить обложку');
    }
  };

  const coverHref = playlist.coverUrl ? `${API_BASE}${playlist.coverUrl}` : null;
  const busy = uploading || renameMutation.isPending || deleteCoverMutation.isPending;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.18 }}
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
        style={{ backgroundColor: 'var(--color-overlay)' }}
        onClick={() => !busy && onClose()}
        role="dialog"
        aria-modal="true"
      >
        <motion.div
          initial={{ scale: 0.96, opacity: 0, y: 8 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.96, opacity: 0, y: 8 }}
          transition={{ type: 'spring', stiffness: 320, damping: 26 }}
          className="w-full max-w-md rounded-[var(--radius-md)] border border-border bg-card p-6 shadow-[var(--shadow-lg)]"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="mb-5 flex items-center justify-between">
            <h2 className="text-base font-semibold tracking-tight">Редактировать плейлист</h2>
            <Button onClick={onClose} variant="ghost" size="icon" className="h-8 w-8" aria-label="Закрыть" disabled={busy}>
              <X size={16} />
            </Button>
          </div>

          <div className="flex items-start gap-4">
            <div className="relative h-24 w-24 shrink-0 overflow-hidden rounded-[var(--radius-sm)] border border-border bg-secondary">
              {coverHref ? (
                <img src={coverHref} alt={playlist.name} className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                  <ImageIcon size={28} />
                </div>
              )}
            </div>
            <div className="flex flex-col gap-2">
              <input
                ref={fileRef}
                type="file"
                accept={COVER_ACCEPT}
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleUpload(file);
                  e.target.value = '';
                }}
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => fileRef.current?.click()}
                disabled={busy}
                className="w-full"
              >
                {uploading ? <Loader2 size={14} className="animate-spin" /> : <ImageIcon size={14} />}
                {coverHref ? 'Сменить обложку' : 'Загрузить обложку'}
              </Button>
              {coverHref && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleDeleteCover}
                  disabled={busy}
                  className="w-full text-[var(--color-danger)] hover:bg-[var(--color-danger-muted)]"
                >
                  {deleteCoverMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                  Удалить обложку
                </Button>
              )}
              <p className="text-[11px] leading-snug text-muted-foreground">
                JPG, PNG, WebP, GIF. До 2 МБ.
              </p>
            </div>
          </div>

          <div className="mt-6 flex flex-col gap-2">
            <label className="text-xs font-medium text-muted-foreground" htmlFor="playlist-name">
              Название
            </label>
            <div className="flex items-center gap-2">
              <Input
                id="playlist-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleRename();
                }}
                disabled={busy}
                maxLength={120}
                autoFocus
              />
              <Button onClick={handleRename} size="sm" disabled={busy || !name.trim() || name.trim() === playlist.name}>
                {renameMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : renamed ? <Check size={14} /> : 'Сохранить'}
              </Button>
            </div>
          </div>

          {error && (
            <p className="mt-4 rounded-[var(--radius-sm)] border border-[var(--color-danger)]/40 bg-[var(--color-danger-muted)] px-3 py-2 text-xs text-[var(--color-danger)]">
              {error}
            </p>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
