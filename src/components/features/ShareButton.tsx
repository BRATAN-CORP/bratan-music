import { useState } from 'react';
import { Check, Share2 } from 'lucide-react';
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
 */
export function ShareButton({ path, shareTitle, shareText, ariaLabel, className }: ShareButtonProps) {
  const t = useT();
  const [copied, setCopied] = useState(false);

  const handleClick = async () => {
    const base = (import.meta.env.BASE_URL ?? '/').replace(/\/$/, '');
    const origin = typeof window === 'undefined' ? '' : window.location.origin;
    const url = `${origin}${base}${path.startsWith('/') ? path : `/${path}`}`;

    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: shareTitle, text: shareText, url });
        return;
      } catch {
        // User cancelled or share failed — fall through to clipboard.
      }
    }
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = url;
      textarea.setAttribute('readonly', '');
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      try {
        document.execCommand('copy');
      } catch {
        window.prompt(t('share.copyPrompt'), url);
      } finally {
        document.body.removeChild(textarea);
      }
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
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
