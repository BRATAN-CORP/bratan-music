/**
 * Reactive `navigator.onLine` hook.
 *
 * Used by:
 *   - `OfflineToastWatcher` to push a transient "Вы офлайн" /
 *     "Снова в сети" toast through the global toast store when
 *     connectivity flips.
 *   - `LibraryPage` to silently swap out the network-driven album /
 *     playlist queries for the offline cache when there's no network.
 *
 * Notes:
 *   - `navigator.onLine` is famously imprecise (Chromium reports
 *     `true` on captive portals), but it's the only signal available
 *     without burning a real ping. The downstream code already
 *     gracefully falls back to the offline blob when a network fetch
 *     fails, so an `onLine === true` mis-report just means we briefly
 *     try the network before failing over. That's acceptable.
 */
import { useEffect, useState } from 'react';

export function useOnline(): boolean {
  const [online, setOnline] = useState(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  );

  useEffect(() => {
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  return online;
}
