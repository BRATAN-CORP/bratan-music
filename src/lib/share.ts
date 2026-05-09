import { copyToClipboard } from '@/lib/trackActions';

/**
 * Build a public share URL for any in-app path (`/album/123`,
 * `/artist/456`, …). Mirrors `buildTrackShareUrl` semantics: prepends
 * the deployed app's origin + base path so the link works for users
 * who weren't already at `/track/...`.
 */
export function buildAppShareUrl(path: string): string {
  const base = (import.meta.env.BASE_URL ?? '/').replace(/\/$/, '');
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  return `${origin}${base}${path.startsWith('/') ? path : `/${path}`}`;
}

interface ShareLinkArgs {
  path: string;
  shareTitle?: string;
  shareText?: string;
}

/**
 * Single-shot "share or copy" — tries the Web Share API first (so
 * iOS / Android open the native sheet), then falls back to the
 * clipboard, then to a `prompt()` so the user can copy manually if
 * neither is available.
 *
 * Used by `ShareButton` (round inline icon) AND by the per-page hero
 * kebab menu (`HeroActionsKebab`) so the two surfaces share one
 * implementation. The kebab variant doesn't need the inline `Check`
 * feedback (the popover closes), but it still wants the same
 * underlying behaviour, so the helper's return value also exposes
 * whether the copy path was used — caller can surface a toast.
 */
export async function shareLink({
  path,
  shareTitle,
  shareText,
}: ShareLinkArgs): Promise<{ shared: boolean; copied: boolean }> {
  const url = buildAppShareUrl(path);

  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    try {
      await navigator.share({ title: shareTitle, text: shareText, url });
      return { shared: true, copied: false };
    } catch {
      // User cancelled or share failed — fall through to clipboard.
    }
  }

  const copied = await copyToClipboard(url);
  if (!copied) {
    try {
      window.prompt('Copy link', url);
    } catch {
      // Headless / non-browser env — nothing useful to do.
    }
  }
  return { shared: false, copied };
}
