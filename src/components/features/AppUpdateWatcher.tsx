/**
 * Detects new service-worker versions and surfaces an in-app
 * "Reload" toast so the user can pick up frontend updates without
 * reinstalling the PWA from the home screen.
 *
 * Why this exists
 * ---------------
 * `vite-plugin-pwa` is configured with `registerType: 'autoUpdate'`
 * (see `vite.config.ts`), which means the workbox runtime will silently
 * fetch a new service worker in the background whenever the browser is
 * online. The new SW activates on the next *cold* page load — but if
 * the user keeps the PWA open across days the warm session keeps
 * running the old assets indefinitely. The user reported having to
 * physically reinstall the PWA from the home screen to "force" an
 * update; this watcher closes that gap by:
 *
 *   1. Hooking into the registration via `useRegisterSW` and reacting
 *      when the workbox client signals `needRefresh = true`.
 *   2. Showing a sticky toast with a "Reload" action that calls
 *      `updateServiceWorker(true)`, which sends `SKIP_WAITING` to the
 *      pending SW and reloads the page once it takes over.
 *
 * What stays intact across the update
 * -----------------------------------
 * Everything stored in IndexedDB persists across SW updates: the
 * offline track blobs, cover images, library metadata, like queue,
 * preferences. Workbox only manages its own *Cache Storage* entries
 * (HTML / JS / CSS / fonts). The two stores are completely separate
 * Storage Standard backends, so updating the frontend never deletes
 * any saved music. The toast copy explicitly tells the user that
 * downloads will be kept so the action feels safe.
 */
import { useEffect, useRef } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { toast } from '@/store/toast';
import { useT } from '@/i18n';

export function AppUpdateWatcher() {
  const t = useT();

  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    immediate: true,
    onRegisteredSW(_swUrl, registration) {
      // Belt-and-braces — workbox already polls on visibility change,
      // but on iOS PWA the visibility events are flaky enough that
      // we add a manual hourly probe so a long-running session still
      // notices a new deploy.
      if (!registration) return;
      const HOURLY = 60 * 60 * 1000;
      window.setInterval(() => {
        registration.update().catch(() => {
          // network blip — workbox will try again on next interval
        });
      }, HOURLY);
    },
  });

  // Track whether we've already pushed the toast for this update so
  // re-renders don't pile multiple "New version available" toasts on
  // top of each other.
  const announcedRef = useRef(false);

  useEffect(() => {
    if (!needRefresh) {
      announcedRef.current = false;
      return;
    }
    if (announcedRef.current) return;
    announcedRef.current = true;
    toast.push({
      tone: 'info',
      title: t('appUpdate.available'),
      message: t('appUpdate.availableHint'),
      // Sticky — the user is the one deciding when to take the
      // reload (might be in the middle of listening to something).
      duration: 0,
      action: {
        label: t('appUpdate.reload'),
        onClick: () => {
          // `true` reloads the page after the new SW takes control.
          void updateServiceWorker(true);
        },
        // Reload is in-flight; the page navigates away anyway, but
        // keep the toast visible until then so the click feels
        // confirmed.
        keepOpen: true,
      },
    });
  }, [needRefresh, t, updateServiceWorker]);

  return null;
}
