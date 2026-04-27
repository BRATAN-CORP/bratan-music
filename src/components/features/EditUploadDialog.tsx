import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Image as ImageIcon, Loader2, Replace, X } from 'lucide-react';
import { useReplaceUploadFile, useUpdateUpload, type UploadTrack, probeAudioDuration } from '@/hooks/useUploads';
import { resizeImageToDataUrl } from '@/lib/imageResize';
import { Button } from '@/components/ui/Button';

interface Props {
  upload: UploadTrack;
  open: boolean;
  onClose: () => void;
}

export function EditUploadDialog({ upload, open, onClose }: Props) {
  const [title, setTitle] = useState(upload.title);
  const [artist, setArtist] = useState(upload.artist);
  const [album, setAlbum] = useState(upload.album ?? '');
  const [cover, setCover] = useState<string | null>(upload.coverUrl ?? null);
  const [error, setError] = useState<string | null>(null);
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
    setError(null);
    setReplaceProgress(null);
  }, [open, upload.id, upload.title, upload.artist, upload.album, upload.coverUrl]);

  const handleSave = async () => {
    setError(null);
    try {
      await update.mutateAsync({
        id: upload.rawId,
        title: title.trim() || 'Без названия',
        artist: artist.trim(),
        album: album.trim(),
        cover: cover === upload.coverUrl ? undefined : cover,
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось сохранить');
    }
  };

  const onCoverPicked = async (file: File) => {
    setError(null);
    try {
      const dataUrl = await resizeImageToDataUrl(file, 512);
      setCover(dataUrl);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось обработать изображение');
    }
  };

  const onAudioPicked = async (file: File) => {
    setError(null);
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
      setError(e instanceof Error ? e.message : 'Ошибка перезаливки');
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[80] flex items-end justify-center sm:items-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <button
            type="button"
            aria-label="Закрыть"
            className="liquid-glass-scrim absolute inset-0"
            onClick={onClose}
          />
          <motion.div
            initial={{ y: 24, opacity: 0, scale: 0.98 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 24, opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className="liquid-glass relative z-10 flex w-full max-w-md flex-col gap-4 rounded-[var(--radius-lg)] p-5 pb-[calc(20px+env(safe-area-inset-bottom))] sm:pb-5"
          >
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-base font-semibold">Редактировать трек</h2>
              <button
                type="button"
                onClick={onClose}
                className="inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] text-muted-foreground hover:bg-secondary"
                aria-label="Закрыть"
              >
                <X size={16} />
              </button>
            </div>

            <div className="flex items-start gap-4">
              <button
                type="button"
                onClick={() => coverInputRef.current?.click()}
                className="group relative flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-[var(--radius-md)] border border-border bg-secondary text-muted-foreground transition-colors hover:bg-background"
                aria-label="Сменить обложку"
              >
                {cover ? (
                  <img src={cover} alt="" className="h-full w-full object-cover" />
                ) : (
                  <ImageIcon size={20} />
                )}
                <span className="absolute inset-0 flex items-center justify-center bg-black/50 text-[10px] font-medium uppercase tracking-[0.2em] text-white opacity-0 transition-opacity group-hover:opacity-100">
                  Обложка
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
                  Название
                  <input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    className="rounded-[var(--radius-sm)] border border-border bg-background px-3 py-2 text-sm text-foreground"
                    maxLength={200}
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                  Исполнители
                  <input
                    value={artist}
                    onChange={(e) => setArtist(e.target.value)}
                    placeholder="Артист 1, Артист 2"
                    className="rounded-[var(--radius-sm)] border border-border bg-background px-3 py-2 text-sm text-foreground"
                    maxLength={200}
                  />
                </label>
              </div>
            </div>
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Альбом (опционально)
              <input
                value={album}
                onChange={(e) => setAlbum(e.target.value)}
                className="rounded-[var(--radius-sm)] border border-border bg-background px-3 py-2 text-sm text-foreground"
                maxLength={200}
              />
            </label>

            <div className="flex items-center justify-between gap-3 rounded-[var(--radius-md)] border border-border bg-background/40 px-3 py-2 text-xs">
              <div className="flex flex-col gap-0.5">
                <span className="font-medium text-foreground">Аудио файл</span>
                <span className="text-muted-foreground">
                  {(upload.sizeBytes / 1024 / 1024).toFixed(1)} МБ · {upload.mimeType}
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
                    Перезалить
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

            {error && <p className="text-xs text-red-400">{error}</p>}

            <div className="flex items-center justify-end gap-2">
              <Button variant="ghost" onClick={onClose}>Отмена</Button>
              <Button onClick={handleSave} disabled={update.isPending}>
                {update.isPending ? <Loader2 size={14} className="animate-spin" /> : null}
                Сохранить
              </Button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
