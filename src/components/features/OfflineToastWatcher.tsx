/**
 * Drives transient online/offline toasts off direct browser
 * connectivity events.
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
 * Why we listen to `online` / `offline` directly instead of going
 * through `useOnline`:
 *   1. The hook re-runs the effect every time `t` (the i18n
 *      translator) changes identity (locale switch, settings sync).
 *      That used to fire a phantom "Снова в сети" / "Вы офлайн" toast
 *      on every language flip — patched in PR #413 with a
 *      `lastOnline` ref guard, but the indirection still made the
 *      flow easy to break. Subscribing to the events directly keeps
 *      the dispatch path independent of React render churn.
 *   2. iOS PWAs occasionally drop the `online` / `offline` events
 *      while the WebView is suspended (lock-screen, app-switcher).
 *      We add a `visibilitychange` re-sync so the toast fires the
 *      moment the user returns to the app and `navigator.onLine`
 *      reports a different value than the last one we acted on.
 *   3. The translator function `t` is captured in a ref so the
 *      handlers always read the latest copy without resubscribing
 *      the listeners — no toast leakage, no stale strings.
 *
 * No DOM is rendered; everything runs through `useToastStore`.
 */
import { useEffect, useRef } from 'react';
import { toast } from '@/store/toast';
import { useT } from '@/i18n';

export function OfflineToastWatcher() {
  const t = useT();
  // Capture the latest `t` in a ref so the event handlers (registered
  // once on mount) always read the current translator without us
  // having to resubscribe and risk losing a connectivity event mid-
  // swap. `t` itself is rebuilt on every locale change.
  const tRef = useRef(t);
  tRef.current = t;

  const lastToastId = useRef<string | null>(null);
  // Tracks the LAST connectivity value we acted on, so a stray
  // `visibilitychange` re-sync that resolves to the same `online`
  // state as before doesn't push a duplicate toast.
  const lastOnlineRef = useRef<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  );

  useEffect(() => {
    const dismissPrev = () => {
      if (lastToastId.current) {
        toast.dismiss(lastToastId.current);
        lastToastId.current = null;
      }
    };

    const announce = (online: boolean) => {
      if (lastOnlineRef.current === online) return;
      lastOnlineRef.current = online;
      dismissPrev();
      if (online) {
        lastToastId.current = toast.success(tRef.current('offline.toastOnline'));
      } else {
        lastToastId.current = toast.warn(tRef.current('offline.toastOffline'));
      }
    };

    // Initial state — only announce if the app boots OFFLINE. Booting
    // online is the silent default; greeting the user with "Снова в
    // сети" on every cold start would be noise.
    const initialOnline =
      typeof navigator !== 'undefined' ? navigator.onLine : true;
    lastOnlineRef.current = initialOnline;
    if (!initialOnline) {
      lastToastId.current = toast.warn(tRef.current('offline.toastOffline'));
    }

    const onOnline = () => announce(true);
    const onOffline = () => announce(false);
    // iOS PWAs sometimes miss the `online` / `offline` event while
    // the WebView is suspended in the app-switcher or behind the
    // lock screen. When the user re-foregrounds the app we re-sync
    // against the live `navigator.onLine` value so the toast fires
    // the moment they get back to a network change they slept
    // through. Browsers without safe-area inset support resolve
    // the listener to a no-op anyway because the value never changes.
    const onVisibility = () => {
      if (typeof document === 'undefined') return;
      if (document.visibilityState !== 'visible') return;
      if (typeof navigator === 'undefined') return;
      announce(navigator.onLine);
    };

    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      document.removeEventListener('visibilitychange', onVisibility);
    };
    // Empty deps — listeners register once for the component lifetime.
    // The `t` translator is reached through `tRef` so locale switches
    // don't tear down and re-subscribe (which would race with a
    // simultaneous connectivity flip).
  }, []);

  return null;
}
