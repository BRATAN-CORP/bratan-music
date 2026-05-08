import { useRef, useState } from 'react';
import { ChevronLeft, Loader2, Music, Upload as UploadIcon, Pencil, Trash2, Pause, Play, Plus } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { AuthGuard } from '@/components/features/AuthGuard';
import { Button } from '@/components/ui/Button';
import { CoverFallback } from '@/components/ui/CoverFallback';
import { TrackListSkeleton } from '@/components/ui/Skeleton';
import { Eyebrow } from '@/components/ui/SectionHeading';
import {
  useCreateUpload,
  useDeleteUpload,
  useUploads,
  probeAudioDuration,
  type UploadTrack,
} from '@/hooks/useUploads';
import { usePlayerStore } from '@/store/player';
import { useTrackPlayback } from '@/hooks/usePlaybackSync';
import { EditUploadDialog } from '@/components/features/EditUploadDialog';
import { AddToPlaylistDialog } from '@/components/features/AddToPlaylistDialog';
import { useT } from '@/i18n';
import { toast } from '@/store/toast';

export function UploadsPage() {
  const t = useT();
  const navigate = useNavigate();
  const { data, isLoading } = useUploads();
  const create = useCreateUpload();
  const remove = useDeleteUpload();
  const setTrack = usePlayerStore((s) => s.setTrack);
  const setQueue = usePlayerStore((s) => s.setQueue);
  const togglePlay = usePlayerStore((s) => s.togglePlay);
  const currentTrackId = usePlayerStore((s) => s.currentTrack?.id);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [progress, setProgress] = useState<number | null>(null);
  const [editing, setEditing] = useState<UploadTrack | null>(null);
  const [addingToPlaylist, setAddingToPlaylist] = useState<UploadTrack | null>(null);

  const onPicked = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    for (const file of Array.from(files)) {
      try {
        const duration = await probeAudioDuration(file);
        await create.mutateAsync({
          file,
          duration,
          onProgress: setProgress,
        });
      } catch (e) {
        toast.error(e instanceof Error ? e.message : t('uploads.errorUpload'));
      }
    }
    setProgress(null);
  };

  const playUpload = (upload: UploadTrack) => {
    if (currentTrackId === upload.id) {
      togglePlay();
      return;
    }
    const all = data ?? [];
    const idx = all.findIndex((u) => u.id === upload.id);
    setQueue(idx >= 0 ? all.slice(idx + 1) : []);
    setTrack(upload);
  };

  return (
    <AuthGuard>
      <div className="mx-auto flex max-w-6xl flex-col gap-6 p-4 sm:p-6 lg:p-10">
        <button
          onClick={() => navigate(-1)}
          className="flex w-fit items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronLeft size={14} />
          {t('uploads.back')}
        </button>
        <div className="flex items-end justify-between gap-4 border-b border-border pb-4">
          <div className="flex flex-col gap-1">
            <Eyebrow>{t('uploads.libraryLabel')}</Eyebrow>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{t('uploads.pageTitle')}</h1>
            <p className="text-xs text-muted-foreground">
              {t('uploads.pageHint')}
            </p>
          </div>
          <Button onClick={() => fileInputRef.current?.click()} disabled={progress != null}>
            {progress != null ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                {Math.round(progress * 100)}%
              </>
            ) : (
              <>
                <UploadIcon size={14} />
                {t('uploads.upload')}
              </>
            )}
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept="audio/*"
            multiple
            className="hidden"
            onChange={(e) => {
              onPicked(e.target.files);
              e.target.value = '';
            }}
          />
        </div>

        {isLoading ? (
          <TrackListSkeleton count={6} />
        ) : data && data.length > 0 ? (
          <div className="flex flex-col gap-1">
            {data.map((u) => (
              <UploadRow
                key={u.id}
                upload={u}
                onPlay={() => playUpload(u)}
                onEdit={() => setEditing(u)}
                onAddToPlaylist={() => setAddingToPlaylist(u)}
                onDelete={async () => {
                  if (confirm(t('uploads.deleteConfirm', { title: u.title }))) {
                    await remove.mutateAsync(u.rawId);
                  }
                }}
              />
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3 rounded-[var(--radius-md)] border border-dashed border-border bg-card py-16 text-center">
            <Music size={28} className="text-muted-foreground" />
            <p className="text-sm text-muted-foreground">{t('uploads.empty')}</p>
            <Button variant="outline" onClick={() => fileInputRef.current?.click()}>
              <UploadIcon size={14} />
              {t('uploads.emptyCta')}
            </Button>
          </div>
        )}

        {editing && (
          <EditUploadDialog
            upload={editing}
            open
            onClose={() => setEditing(null)}
          />
        )}
        {addingToPlaylist && (
          <AddToPlaylistDialog
            track={addingToPlaylist}
            open
            onClose={() => setAddingToPlaylist(null)}
          />
        )}
      </div>
    </AuthGuard>
  );
}

interface RowProps {
  upload: UploadTrack;
  onPlay: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onAddToPlaylist: () => void;
}

function UploadRow({ upload, onPlay, onEdit, onDelete, onAddToPlaylist }: RowProps) {
  const t = useT();
  const { isActive, isActivePlaying } = useTrackPlayback(upload.id);
  return (
    <div className="group flex items-center gap-3 rounded-[var(--radius-md)] border border-transparent px-3 py-2 transition-colors hover:border-border hover:bg-secondary">
      <button
        type="button"
        onClick={onPlay}
        className="relative flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-[var(--radius-sm)] border border-border bg-background text-muted-foreground"
        aria-label={isActivePlaying ? t('uploads.pause') : t('uploads.play')}
      >
        <CoverFallback
          src={upload.coverUrl}
          name={upload.title || upload.artist || 'Track'}
          initialsClassName="text-[10px]"
        />
        <span
          className={
            'absolute inset-0 flex items-center justify-center bg-black/55 transition-opacity ' +
            (isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100')
          }
        >
          {isActivePlaying ? (
            <Pause size={14} className="fill-white text-white" />
          ) : (
            <Play size={14} className="fill-white text-white" />
          )}
        </span>
      </button>
      <button
        type="button"
        onClick={onPlay}
        className="flex min-w-0 flex-1 flex-col text-left"
      >
        <span className="truncate text-sm font-medium">{upload.title}</span>
        <span className="truncate text-xs text-muted-foreground">
          {upload.artist || '—'}
          {upload.duration ? ` · ${formatDuration(upload.duration)}` : ''}
        </span>
      </button>
      <button
        type="button"
        onClick={onAddToPlaylist}
        className="hidden h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] text-muted-foreground transition-colors hover:bg-background hover:text-foreground sm:inline-flex"
        aria-label={t('uploads.addToPlaylistShort')}
        title={t('uploads.addToPlaylist')}
      >
        <Plus size={14} />
      </button>
      <button
        type="button"
        onClick={onEdit}
        className="inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
        aria-label={t('uploads.edit')}
        title={t('uploads.edit')}
      >
        <Pencil size={14} />
      </button>
      <button
        type="button"
        onClick={onDelete}
        className="inline-flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] text-muted-foreground transition-colors hover:bg-background hover:text-red-300"
        aria-label={t('uploads.delete')}
        title={t('uploads.delete')}
      >
        <Trash2 size={14} />
      </button>
    </div>
  );
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}
