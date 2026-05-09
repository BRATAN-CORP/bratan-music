import { useState } from 'react';
import { Check, Share2 } from 'lucide-react';
import { shareLink } from '@/lib/share';
import { useT } from '@/i18n';

interface ShareButtonProps {
  /** Pathname relative to the deployed app, e.g. "/artist/123". */
  path: string;
  /** Title used by `navigator.share` when the platform supports it. */
  shareTitle?: string;
  /** Optional descriptive text passed to `navigator.share`. */
  shareText?: string;
  ariaLabel?: string;
  className?: string;
}

/**
 * Compact "copy link" button reused across the artist and album
 * detail pages. Tries the Web Share API first (so iOS/Android show
 * the native share sheet), then falls back to clipboard, and
 * finally to a hidden textarea + execCommand copy for environments
 * where the Clipboard API is unavailable. Shows a check-mark for a
 * brief moment after a successful copy so the user gets feedback.
 *
 * The actual share/clipboard plumbing lives in `lib/share.ts` so the
 * hero overflow kebab (`HeroActionsKebab`) can reuse it without
 * pulling this component in for its own row.
 */
export function ShareButton({ path, shareTitle, shareText, ariaLabel, className }: ShareButtonProps) {
  const t = useT();
  const [copied, setCopied] = useState(false);

  const handleClick = async () => {
    const result = await shareLink({ path, shareTitle, shareText });
    if (result.copied) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={ariaLabel ?? t('share.shareGeneric')}
      className={
        className ??
        'inline-flex h-9 w-9 items-center justify-center rounded-full border border-border text-muted-foreground transition-all hover:bg-secondary hover:text-foreground active:scale-90'
      }
    >
      {copied ? (
        <Check size={16} className="text-[var(--color-accent)]" />
      ) : (
        <Share2 size={16} />
      )}
    </button>
  );
}
