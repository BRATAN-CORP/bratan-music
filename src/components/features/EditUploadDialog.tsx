import { useEffect, useId, useRef, useState } from 'react';
import { Image as ImageIcon, Loader2, Replace } from 'lucide-react';
import { useReplaceUploadFile, useUpdateUpload, type UploadTrack, probeAudioDuration } from '@/hooks/useUploads';
import { resizeImageToDataUrl } from '@/lib/imageResize';
import { Button } from '@/components/ui/Button';
import { Modal, ModalHeader } from '@/components/ui/Modal';
import { useT } from '@/i18n';
import { toast } from '@/store/toast';

interface Props {
  upload: UploadTrack;
  open: boolean;
  onClose: () => void;
}

export function EditUploadDialog({ upload, open, onClose }: Props) {
  const t = useT();
  const titleId = useId();
  const [title, setTitle] = useState(upload.title);
  const [artist, setArtist] = useState(upload.artist);
  const [album, setAlbum] = useState(upload.album ?? '');
  const [cover, setCover] = useState<string | null>(upload.coverUrl ?? null);
  const [replaceProgress, setReplaceProgress] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);
  const update = useUpdateUpload();
  const replaceFile = useReplaceUploadFile();

  // Sync state when reopening on a different upload.
  useEffect(() => {
    if (!open) return;
    setTitle(upload.title);
    setArtist(upload.artist);
    setAlbum(upload.album ?? '');
    setCover(upload.coverUrl ?? null);
    setReplaceProgress(null);
  }, [open, upload.id, upload.title, upload.artist, upload.album, upload.coverUrl]);

  const handleSave = async () => {
    try {
      await update.mutateAsync({
        id: upload.rawId,
        title: title.trim() || t('editUpload.untitled'),
        artist: artist.trim(),
        album: album.trim(),
        cover: cover === upload.coverUrl ? undefined : cover,
      });
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('editUpload.errorSave'));
    }
  };

  const onCoverPicked = async (file: File) => {
    try {
      const dataUrl = await resizeImageToDataUrl(file, 512);
      setCover(dataUrl);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('editUpload.errorImage'));
    }
  };

  const onAudioPicked = async (file: File) => {
    try {
      const duration = await probeAudioDuration(file);
      await replaceFile.mutateAsync({
        id: upload.rawId,
        file,
        duration,
        onProgress: (p) => setReplaceProgress(p),
      });
      setReplaceProgress(null);
    } catch (e) {
      setReplaceProgress(null);
      toast.error(e instanceof Error ? e.message : t('editUpload.errorReplace'));
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      align="sheet"
      labelledBy={titleId}
      panelClassName="max-w-md flex flex-col gap-4 p-5 pb-[calc(20px+var(--pwa-safe-bottom))] sm:pb-5"
    >
      <ModalHeader
        titleId={titleId}
        title={t('editUpload.title')}
        onClose={onClose}
        closeAriaLabel={t('editUpload.close')}
      />

      <div className="flex items-start gap-4">
        <button
          type="button"
          onClick={() => coverInputRef.current?.click()}
          className="group relative flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-[var(--radius-md)] border border-border bg-secondary text-muted-foreground transition-colors hover:bg-background"
          aria-label={t('editUpload.changeCover')}
        >
          {cover ? (
            <img src={cover} alt="" className="h-full w-full object-cover" />
          ) : (
            <ImageIcon size={20} />
          )}
          <span className="absolute inset-0 flex items-center justify-center bg-black/50 text-[10px] font-medium uppercase tracking-[0.2em] text-white opacity-0 transition-opacity group-hover:opacity-100">
            {t('editUpload.coverLabel')}
          </span>
        </button>
        <input
          ref={coverInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onCoverPicked(f);
            e.target.value = '';
          }}
        />
        <div className="flex flex-1 flex-col gap-2">
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            {t('editUpload.fieldTitle')}
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="rounded-[var(--radius-sm)] border border-border bg-background px-3 py-2 text-sm text-foreground"
              maxLength={200}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            {t('editUpload.fieldArtists')}
            <input
              value={artist}
              onChange={(e) => setArtist(e.target.value)}
              placeholder={t('editUpload.fieldArtistsPlaceholder')}
              className="rounded-[var(--radius-sm)] border border-border bg-background px-3 py-2 text-sm text-foreground"
              maxLength={200}
            />
          </label>
        </div>
      </div>
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        {t('editUpload.fieldAlbum')}
        <input
          value={album}
          onChange={(e) => setAlbum(e.target.value)}
          className="rounded-[var(--radius-sm)] border border-border bg-background px-3 py-2 text-sm text-foreground"
          maxLength={200}
        />
      </label>

      <div className="flex items-center justify-between gap-3 rounded-[var(--radius-md)] border border-border bg-background/40 px-3 py-2 text-xs">
        <div className="flex flex-col gap-0.5">
          <span className="font-medium text-foreground">{t('editUpload.audioFile')}</span>
          <span className="text-muted-foreground">
            {t('editUpload.audioMeta', {
              size: (upload.sizeBytes / 1024 / 1024).toFixed(1),
              mime: upload.mimeType,
            })}
          </span>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => fileInputRef.current?.click()}
          disabled={replaceProgress != null}
        >
          {replaceProgress != null ? (
            <>
              <Loader2 size={12} className="animate-spin" />
              {Math.round(replaceProgress * 100)}%
            </>
          ) : (
            <>
              <Replace size={12} />
              {t('editUpload.replace')}
            </>
          )}
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept="audio/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onAudioPicked(f);
            e.target.value = '';
          }}
        />
      </div>

      <div className="flex items-center justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>{t('editUpload.cancel')}</Button>
        <Button onClick={handleSave} disabled={update.isPending}>
          {update.isPending ? <Loader2 size={14} className="animate-spin" /> : null}
          {t('editUpload.save')}
        </Button>
      </div>
    </Modal>
  );
}
