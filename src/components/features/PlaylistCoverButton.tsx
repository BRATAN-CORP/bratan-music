import { useRef } from 'react';
import { ImagePlus, Loader2, Trash2 } from 'lucide-react';
import { useRemovePlaylistCover, useSetPlaylistCover } from '@/hooks/useLibrary';
import { resizeImageToDataUrl } from '@/lib/imageResize';
import { useT } from '@/i18n';
import { toast } from '@/store/toast';

interface PlaylistCoverButtonProps {
  playlistId: string;
  hasCover: boolean;
  className?: string;
  /** Optional inline label rendered next to the icon (defaults to none). */
  label?: string;
}

export function PlaylistCoverButton({
  playlistId, hasCover, className, label,
}: PlaylistCoverButtonProps) {
  const t = useT();
  const inputRef = useRef<HTMLInputElement>(null);
  const setCover = useSetPlaylistCover();
  const removeCover = useRemovePlaylistCover();
  const busy = setCover.isPending || removeCover.isPending;

  const handleFile = async (file: File | null) => {
    if (!file) return;
    try {
      const dataUrl = await resizeImageToDataUrl(file);
      await setCover.mutateAsync({ id: playlistId, dataUrl });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('cover.errorUpload'));
    }
  };

  const handleRemove = async () => {
    if (!hasCover) return;
    try {
      await removeCover.mutateAsync(playlistId);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('cover.errorGeneric'));
    }
  };

  return (
    <div className={'flex flex-col gap-1 ' + (className ?? '')}>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0] ?? null;
          handleFile(file);
          // reset so the same file can be re-selected
          e.target.value = '';
        }}
      />
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
          className="inline-flex items-center gap-2 rounded-[var(--radius-sm)] border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-secondary disabled:opacity-60"
        >
          {setCover.isPending ? <Loader2 size={12} className="animate-spin" /> : <ImagePlus size={12} />}
          {label ?? (hasCover ? t('cover.change') : t('cover.upload'))}
        </button>
        {hasCover && (
          <button
            type="button"
            disabled={busy}
            onClick={handleRemove}
            className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-transparent px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-60"
            aria-label={t('cover.remove')}
          >
            {removeCover.isPending ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
            {t('cover.removeShort')}
          </button>
        )}
      </div>
    </div>
  );
}
