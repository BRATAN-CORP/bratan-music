import { useEffect } from 'react';

let lockCount = 0;
let previousOverflow: string | null = null;
let previousPaddingRight: string | null = null;

/**
 * Lock body scroll while `active` is true. Uses a process-wide counter so
 * stacked modals (e.g. the share dialog opened from within a playlist
 * page that itself opened from the rename dialog) don't release the lock
 * until the last consumer unmounts.
 *
 * Adds a transient `padding-right` equal to the scrollbar width so the
 * page doesn't horizontally jump when the scrollbar is removed —
 * `<html>` already declares `scrollbar-gutter: stable` for the same
 * reason, but this is the extra guard for browsers that don't honour
 * the gutter property (older iOS Safari).
 */
export function useBodyScrollLock(active: boolean) {
  useEffect(() => {
    if (!active) return;
    if (typeof document === 'undefined') return;

    const body = document.body;
    if (lockCount === 0) {
      previousOverflow = body.style.overflow;
      previousPaddingRight = body.style.paddingRight;
      const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
      if (scrollbarWidth > 0) {
        body.style.paddingRight = `${scrollbarWidth}px`;
      }
      body.style.overflow = 'hidden';
    }
    lockCount += 1;

    return () => {
      lockCount = Math.max(0, lockCount - 1);
      if (lockCount === 0) {
        body.style.overflow = previousOverflow ?? '';
        body.style.paddingRight = previousPaddingRight ?? '';
        previousOverflow = null;
        previousPaddingRight = null;
      }
    };
  }, [active]);
}
