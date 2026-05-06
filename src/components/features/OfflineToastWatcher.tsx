/**
 * Drives transient online/offline toasts off the `useOnline` hook.
 *
 * Replaces the previous always-visible "Вы офлайн" sticky banner that
 * sat at the top of the page and got hidden by the iPhone notch when
 * the app is installed as a PWA. Now the same connectivity events
 * surface through the global `toast` store the app uses for every
 * other transient notification (audio errors, save confirmations,
 * sync queue results), so:
 *
 *   - The status disappears on its own after a few seconds.
 *   - Multiple flips collapse to a single visible toast (we dismiss
 *     the previous one before pushing the next).
 *   - The first mount stays silent if the user opens the app online —
 *     no need to greet the user with "Вы онлайн" when nothing changed.
 *     If the app boots offline we DO push the offline toast on first
 *     mount so the user knows their library is in cache-only mode.
 *
 * No DOM is rendered; everything runs through `useToastStore`.
 */
import { useEffect, useRef } from 'react';
import { useOnline } from '@/hooks/useOnline';
import { toast } from '@/store/toast';
import { useT } from '@/i18n';

export function OfflineToastWatcher() {
  const t = useT();
  const online = useOnline();
  const isFirstMount = useRef(true);
  const lastToastId = useRef<string | null>(null);

  useEffect(() => {
    const dismissPrev = () => {
      if (lastToastId.current) {
        toast.dismiss(lastToastId.current);
        lastToastId.current = null;
      }
    };

    if (isFirstMount.current) {
      isFirstMount.current = false;
      // Only announce the initial state if we boot offline — opening
      // the app online is the silent default and shouldn't generate
      // a toast.
      if (!online) {
        lastToastId.current = toast.warn(t('offline.toastOffline'));
      }
      return;
    }

    dismissPrev();
    if (online) {
      lastToastId.current = toast.success(t('offline.toastOnline'));
    } else {
      lastToastId.current = toast.warn(t('offline.toastOffline'));
    }
  }, [online, t]);

  return null;
}
