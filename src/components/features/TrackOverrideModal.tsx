import { useEffect, useState, useRef } from 'react';
import { Upload, X, Loader2, Trash2 } from 'lucide-react';
import { useAuthStore } from '@/store/auth';
import { usePlayerStore } from '@/store/player';
import { Button } from '@/components/ui/Button';
import { api } from '@/lib/api';

interface TrackOverrideModalProps {
  open: boolean;
  onClose: () => void;
  trackId: string;
  trackTitle: string;
}

const API_BASE = import.meta.env.VITE_API_URL ?? 'https://bratan-music-api.bratan-corp.workers.dev';

interface OverrideStatus {
  exists: boolean;
  override?: { mime_type?: string; size_bytes?: number };
}

export function TrackOverrideModal({ open, onClose, trackId, trackTitle }: TrackOverrideModalProps) {
  const [uploading, setUploading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<OverrideStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const token = useAuthStore((s) => s.accessToken);
  const bumpStream = usePlayerStore((s) => s.bumpStream);
  const currentTrackId = usePlayerStore((s) => s.currentTrack?.id);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setError(null);
    setStatusLoading(true);
    api.get<OverrideStatus>(`/tracks/${trackId}/override`)
      .then((data) => { if (!cancelled) setStatus(data); })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : 'Ошибка'); })
      .finally(() => { if (!cancelled) setStatusLoading(false); });
    return () => { cancelled = true; };
  }, [open, trackId]);

  if (!open) return null;

  const refreshStream = () => {
    if (currentTrackId === trackId) bumpStream();
  };

  const handleUpload = async (file: File) => {
    setUploading(true);
    setError(null);

    try {
      const res = await fetch(`${API_BASE}/tracks/${trackId}/override`, {
        method: 'PUT',
        headers: {
          'Content-Type': file.type,
          'Content-Length': String(file.size),
          'Authorization': `Bearer ${token}`,
        },
        body: file,
      });

      if (!res.ok) {
        const data = await res.json() as { error?: string };
        throw new Error(data.error ?? 'Ошибка загрузки');
      }

      setStatus({ exists: true, override: { mime_type: file.type, size_bytes: file.size } });
      refreshStream();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка');
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    setError(null);
    try {
      await api.delete(`/tracks/${trackId}/override`);
      setStatus({ exists: false });
      refreshStream();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка');
    } finally {
      setDeleting(false);
    }
  };

  const hasOverride = status?.exists === true;

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
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold tracking-tight">Перезалив</h2>
          <Button onClick={onClose} variant="ghost" size="icon" className="h-8 w-8" aria-label="Закрыть">
            <X size={16} />
          </Button>
        </div>

        <p className="mb-5 truncate text-xs text-muted-foreground">{trackTitle}</p>

        {statusLoading ? (
          <div className="flex items-center justify-center gap-2 py-6 text-xs text-muted-foreground">
            <Loader2 size={14} className="animate-spin" />
            Проверка...
          </div>
        ) : (
          <>
            <input
              ref={fileRef}
              type="file"
              accept="audio/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleUpload(file);
              }}
            />

            {hasOverride && (
              <p className="mb-3 rounded-[var(--radius-sm)] border border-border bg-secondary px-3 py-2 text-xs text-muted-foreground">
                Сейчас играет ваша версия. Можно заменить новым файлом или удалить, чтобы вернуть оригинал.
              </p>
            )}

            <div className="flex flex-col gap-2">
              <Button
                onClick={() => fileRef.current?.click()}
                disabled={uploading || deleting}
                className="w-full"
                variant="outline"
              >
                {uploading ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    Загрузка...
                  </>
                ) : (
                  <>
                    <Upload size={14} />
                    {hasOverride ? 'Заменить файл' : 'Выбрать файл'}
                  </>
                )}
              </Button>

              {hasOverride && (
                <Button
                  onClick={handleDelete}
                  disabled={uploading || deleting}
                  className="w-full"
                  variant="ghost"
                >
                  {deleting ? (
                    <>
                      <Loader2 size={14} className="animate-spin" />
                      Удаление...
                    </>
                  ) : (
                    <>
                      <Trash2 size={14} />
                      Удалить мою версию
                    </>
                  )}
                </Button>
              )}
            </div>
          </>
        )}

        {error && (
          <p className="mt-3 text-center text-xs text-[var(--color-danger)]">{error}</p>
        )}
      </div>
    </div>
  );
}
