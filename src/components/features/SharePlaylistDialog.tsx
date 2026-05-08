import { useEffect, useId, useRef, useState } from 'react';
import { Check, Copy, Globe, Link as LinkIcon, Loader2, Lock } from 'lucide-react';
import { motion } from 'motion/react';
import { Button } from '@/components/ui/Button';
import { Modal, ModalHeader } from '@/components/ui/Modal';
import { useSharePlaylist, buildShareUrl } from '@/hooks/useShare';
import type { Playlist } from '@/types';
import { useT } from '@/i18n';

interface SharePlaylistDialogProps {
  open: boolean;
  onClose: () => void;
  playlist: Playlist;
}

/**
 * Share-management sheet for an owned playlist.
 * - Single toggle for `is_public` (lock <-> globe).
 * - When public, exposes the share URL with a one-click copy
 *   button (falls back to selecting the input if clipboard is
 *   unavailable, e.g. Telegram WebView on iOS).
 * - Brief copy of the sharing semantics so the user understands
 *   that saved copies are read-only references.
 */
export function SharePlaylistDialog({ open, onClose, playlist }: SharePlaylistDialogProps) {
  const t = useT();
  const titleId = useId();
  const share = useSharePlaylist();
  const [optimisticPublic, setOptimisticPublic] = useState<boolean | null>(null);
  const [copied, setCopied] = useState(false);
  const copyTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset local state when the dialog re-opens for a different
  // playlist (or after a previous close).
  useEffect(() => {
    if (!open) {
      setOptimisticPublic(null);
      setCopied(false);
    }
  }, [open]);

  useEffect(() => {
    return () => {
      if (copyTimeout.current) clearTimeout(copyTimeout.current);
    };
  }, []);

  const isPublic = optimisticPublic ?? Boolean(playlist.isPublic);
  const token = share.data?.shareToken ?? playlist.shareToken ?? null;
  const url = token ? buildShareUrl(token) : null;

  const handleToggle = async () => {
    const next = !isPublic;
    setOptimisticPublic(next);
    try {
      await share.mutateAsync({ id: playlist.id, isPublic: next });
    } catch {
      // Roll back optimistic flip on failure so the toggle reflects
      // truth — server error keeps the playlist private.
      setOptimisticPublic(!next);
    }
  };

  const handleCopy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      if (copyTimeout.current) clearTimeout(copyTimeout.current);
      copyTimeout.current = setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard API is gated in some embedded webviews; fall back
      // to selecting the input so the user can copy manually.
      const input = document.getElementById('share-url-input') as HTMLInputElement | null;
      input?.select();
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      align="sheet"
      busy={share.isPending}
      labelledBy={titleId}
      panelClassName="max-w-md p-6"
    >
      <ModalHeader
        titleId={titleId}
        title={t('playlist.share_dialog.title')}
        description={playlist.name}
        onClose={onClose}
        closeAriaLabel={t('common.close')}
        className="mb-4"
      />

      <button
        type="button"
        onClick={handleToggle}
        disabled={share.isPending}
        className="group flex w-full items-center justify-between gap-3 rounded-[var(--radius-md)] border border-border bg-background/40 p-4 text-left transition-colors hover:bg-secondary/40 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <div className="flex items-center gap-3">
          <span
            className={
              'flex h-10 w-10 items-center justify-center rounded-full transition-colors ' +
              (isPublic
                ? 'bg-[var(--color-accent)]/15 text-[var(--color-accent)]'
                : 'bg-secondary text-muted-foreground')
            }
          >
            {isPublic ? <Globe size={18} /> : <Lock size={18} />}
          </span>
          <div className="flex flex-col gap-0.5">
            <span className="text-sm font-medium">{t('playlist.share_dialog.shareByLink')}</span>
            <span className="text-xs text-muted-foreground">
              {isPublic
                ? t('playlist.share_dialog.publicOn')
                : t('playlist.share_dialog.publicOff')}
            </span>
          </div>
        </div>
        <span
          className={
            'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ' +
            (isPublic ? 'bg-[var(--color-accent)]' : 'bg-secondary')
          }
        >
          <motion.span
            layout
            className="block h-5 w-5 rounded-full bg-white shadow"
            style={{ marginLeft: isPublic ? 22 : 2 }}
            transition={{ type: 'spring', stiffness: 500, damping: 30 }}
          />
        </span>
      </button>

      {isPublic && url && (
        <motion.div
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.04, duration: 0.2 }}
          className="mt-3 flex items-center gap-2 rounded-[var(--radius-md)] border border-border bg-background/60 p-2 pl-3"
        >
          <LinkIcon size={14} className="shrink-0 text-muted-foreground" />
          <input
            id="share-url-input"
            readOnly
            value={url}
            onFocus={(e) => e.target.select()}
            className="min-w-0 flex-1 truncate bg-transparent text-xs text-foreground outline-none"
          />
          <Button onClick={handleCopy} size="sm" className="shrink-0" aria-label={t('playlist.share_dialog.copyAria')}>
            {copied ? (
              <>
                <Check size={13} /> {t('playlist.share_dialog.copied')}
              </>
            ) : (
              <>
                <Copy size={13} /> {t('playlist.share_dialog.copy')}
              </>
            )}
          </Button>
        </motion.div>
      )}

      {share.isError && (
        <p className="mt-3 rounded-[var(--radius-sm)] bg-[var(--color-danger-muted)] px-3 py-2 text-xs text-[var(--color-danger)]">
          {share.error instanceof Error ? share.error.message : t('playlist.share_dialog.updateError')}
        </p>
      )}

      <p className="mt-4 text-[11px] leading-relaxed text-muted-foreground/80">
        {t('playlist.share_dialog.savedHint')}
      </p>

      {share.isPending && (
        <div className="mt-3 flex items-center justify-center text-muted-foreground">
          <Loader2 size={14} className="animate-spin" />
        </div>
      )}
    </Modal>
  );
}
