import { useState, useRef } from 'react';
import { Upload, X, Loader2 } from 'lucide-react';
import { useAuthStore } from '@/store/auth';

interface TrackOverrideModalProps {
  open: boolean;
  onClose: () => void;
  trackId: string;
  trackTitle: string;
}

const API_BASE = import.meta.env.VITE_API_URL ?? 'https://api.bratan-corp.workers.dev';

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
          <h2 className="text-lg font-bold">Перезалив</h2>
          <button onClick={onClose} className="p-1 hover:opacity-70">
            <X size={20} />
          </button>
        </div>

        <p className="text-sm mb-4" style={{ color: 'var(--color-text-muted)' }}>
          {trackTitle}
        </p>

        {success ? (
          <p style={{ color: 'var(--color-accent)' }} className="text-sm text-center py-4">
            Файл загружен!
          </p>
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
            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-medium disabled:opacity-50"
              style={{ backgroundColor: 'var(--color-bg-muted)', color: 'var(--color-text)' }}
            >
              {uploading ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  Загрузка...
                </>
              ) : (
                <>
                  <Upload size={16} />
                  Выбрать файл
                </>
              )}
            </button>
          </>
        )}

        {error && (
          <p className="text-xs mt-3 text-center" style={{ color: 'var(--color-danger)' }}>
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
