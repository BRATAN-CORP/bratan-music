import { useEffect, useId, useState, useRef } from 'react';
import { Upload, Loader2, Trash2 } from 'lucide-react';
import { useAuthStore } from '@/store/auth';
import { usePlayerStore } from '@/store/player';
import { Button } from '@/components/ui/Button';
import { Modal, ModalHeader } from '@/components/ui/Modal';
import { api } from '@/lib/api';
import { useT } from '@/i18n';
import { toast } from '@/store/toast';

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
  const t = useT();
  const titleId = useId();
  const [uploading, setUploading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [status, setStatus] = useState<OverrideStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const token = useAuthStore((s) => s.accessToken);
  const bumpStream = usePlayerStore((s) => s.bumpStream);
  const currentTrackId = usePlayerStore((s) => s.currentTrack?.id);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setStatusLoading(true);
    api.get<OverrideStatus>(`/tracks/${trackId}/override`)
      .then((data) => { if (!cancelled) setStatus(data); })
      .catch((err) => { if (!cancelled) toast.error(err instanceof Error ? err.message : t('override.errorGeneric')); })
      .finally(() => { if (!cancelled) setStatusLoading(false); });
    return () => { cancelled = true; };
    // `t` is intentionally omitted: re-running the effect on locale change
    // would refetch the override status and reset the dialog mid-flight.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, trackId]);

  const refreshStream = () => {
    if (currentTrackId === trackId) bumpStream();
  };

  const handleUpload = async (file: File) => {
    setUploading(true);
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
        throw new Error(data.error ?? t('override.errorUpload'));
      }

      setStatus({ exists: true, override: { mime_type: file.type, size_bytes: file.size } });
      refreshStream();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('override.errorGeneric'));
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await api.delete(`/tracks/${trackId}/override`);
      setStatus({ exists: false });
      refreshStream();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('override.errorGeneric'));
    } finally {
      setDeleting(false);
    }
  };

  const hasOverride = status?.exists === true;
  const busy = uploading || deleting;

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      busy={busy}
      labelledBy={titleId}
      panelClassName="p-6"
    >
      <ModalHeader
        titleId={titleId}
        title={t('override.title')}
        onClose={onClose}
        closeAriaLabel={t('override.close')}
        className="mb-4"
      />

      <p className="mb-5 truncate text-xs text-muted-foreground">{trackTitle}</p>

      {statusLoading ? (
        <div className="flex items-center justify-center gap-2 py-6 text-xs text-muted-foreground">
          <Loader2 size={14} className="animate-spin" />
          {t('override.checking')}
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
              {t('override.currentVersion')}
            </p>
          )}

          <div className="flex flex-col gap-2">
            <Button
              onClick={() => fileRef.current?.click()}
              disabled={busy}
              className="w-full"
              variant="outline"
            >
              {uploading ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  {t('override.uploading')}
                </>
              ) : (
                <>
                  <Upload size={14} />
                  {hasOverride ? t('override.replaceFile') : t('override.pickFile')}
                </>
              )}
            </Button>

            {hasOverride && (
              <Button
                onClick={handleDelete}
                disabled={busy}
                className="w-full"
                variant="ghost"
              >
                {deleting ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    {t('override.deleting')}
                  </>
                ) : (
                  <>
                    <Trash2 size={14} />
                    {t('override.deleteMy')}
                  </>
                )}
              </Button>
            )}
          </div>
        </>
      )}
    </Modal>
  );
}
