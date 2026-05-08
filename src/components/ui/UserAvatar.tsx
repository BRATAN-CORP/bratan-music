import { cn } from '@/lib/utils';
import { fallbackGradient, nameInitials } from '@/lib/coverFallback';
import { useT } from '@/i18n';

/**
 * Single source of truth for rendering a user's avatar across the
 * app. The fallback (when there's no avatar URL or the image fails)
 * always derives initials from `name` — falling back to `username`
 * only when name is missing — and uses `fallbackGradient` for a
 * stable per-seed colour. This unifies what used to be three or four
 * slightly-different ad-hoc avatar fallbacks (admin grid, profile
 * hero, rooms list, etc.) into one consistent visual.
 *
 * Online indicator (when `online` is true) renders OUTSIDE the
 * avatar's clip path, so circular crops don't eat half the dot.
 */

export interface UserAvatarProps {
  /** Real avatar URL when available. */
  src?: string | null;
  /** Display name — preferred seed for initials and gradient hue. */
  name?: string | null;
  /** Telegram @username, used as a secondary seed. */
  username?: string | null;
  /** Stable id, last-resort seed so empty-name users still get
   *  a deterministic colour instead of all sharing the same one. */
  id?: string | null;
  /** Tailwind class string for the outer wrapper — sets size + shape. */
  className?: string;
  /** Override font size of initials inside the fallback. */
  initialsClassName?: string;
  /** Render a small online indicator dot in the bottom-right corner. */
  online?: boolean;
  /** Optional alt text. Defaults to `name` / `username` / 'User'. */
  alt?: string;
  loading?: 'lazy' | 'eager';
}

export function UserAvatar({
  src,
  name,
  username,
  id,
  className,
  initialsClassName,
  online,
  alt,
  loading = 'lazy',
}: UserAvatarProps) {
  const t = useT();
  const seed = (name?.trim() || username?.trim() || id || '?').slice(0, 64);
  const display = name?.trim() || username?.trim() || 'User';

  return (
    <span className={cn('relative inline-block shrink-0', className)}>
      <span className="block h-full w-full overflow-hidden rounded-[inherit]">
        {src ? (
          <img
            src={src}
            alt={alt ?? display}
            loading={loading}
            className="h-full w-full object-cover"
            onError={(e) => {
              // Detach the broken <img> and let the gradient fallback
              // (sibling) become visible. Hide via CSS rather than
              // rerendering — avoids a state-tracked error path that
              // would re-render every avatar in long lists on a
              // single failure.
              (e.currentTarget as HTMLImageElement).style.display = 'none';
              const sib = (e.currentTarget.nextElementSibling as HTMLElement | null);
              if (sib) sib.style.display = 'flex';
            }}
          />
        ) : null}
        <span
          aria-hidden={!!src}
          className={cn(
            'h-full w-full items-center justify-center font-semibold uppercase text-white',
            src ? 'hidden' : 'flex',
            initialsClassName ?? 'text-sm',
          )}
          style={{ background: fallbackGradient(seed) }}
        >
          {nameInitials(display)}
        </span>
      </span>
      {online && (
        <span
          aria-label={t('common.online')}
          className="absolute right-0 bottom-0 h-2.5 w-2.5 rounded-full border-2 border-background bg-emerald-500 shadow-[0_0_0_1px_var(--color-bg-elevated)]"
        />
      )}
    </span>
  );
}
