import { useState, useRef } from 'react';
import { Upload, X, Loader2 } from 'lucide-react';
import { useAuthStore } from '@/store/auth';
import { Button } from '@/components/ui/Button';

interface TrackOverrideModalProps {
  open: boolean;
  onClose: () => void;
  trackId: string;
  trackTitle: string;
}

const API_BASE = import.meta.env.VITE_API_URL ?? 'https://bratan-music-api.bratan-corp.workers.dev';

export function TrackOverrideModal({ open, onClose, trackId, trackTitle }: TrackOverrideModalProps) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const token = useAuthStore((s) => s.accessToken);

  if (!open) return null;

  const handleUpload = async (file: File) => {
    setUploading(true);
    setError(null);
    setSuccess(false);

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

      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка');
    } finally {
      setUploading(false);
    }
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
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold tracking-tight">Перезалив</h2>
          <Button onClick={onClose} variant="ghost" size="icon" className="h-8 w-8" aria-label="Закрыть">
            <X size={16} />
          </Button>
        </div>

        <p className="mb-5 truncate text-xs text-muted-foreground">{trackTitle}</p>

        {success ? (
          <p className="py-4 text-center text-sm font-medium">Файл загружен.</p>
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
            <Button
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
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
                  Выбрать файл
                </>
              )}
            </Button>
          </>
        )}

        {error && (
          <p className="mt-3 text-center text-xs text-[var(--color-danger)]">{error}</p>
        )}
      </div>
    </div>
  );
}
