import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { AppRouter } from '@/app/router';
import { SplashScreen } from '@/components/ui/SplashScreen';
import { getTelegramWebApp } from '@/hooks/useAuth';
import { I18nProvider } from '@/i18n';
import { queryClient } from '@/lib/queryClient';
import { wireOfflineBridge } from '@/store/offline';
import { startSyncQueueAutoFlush } from '@/lib/offline/syncQueue';
import { startCoverBackfill } from '@/lib/offline/coverBackfill';
import '@/styles/globals.scss';

getTelegramWebApp()?.ready?.();
getTelegramWebApp()?.expand?.();

// Plug the framework-agnostic downloads manager into the React store
// exactly once at boot. Subsequent fast-refresh reloads short-circuit
// inside `wireOfflineBridge` so we never end up with two listeners
// for the same event bus.
wireOfflineBridge();

// Drain any offline-buffered likes / play history left over from a
// previous session, then attach an `online` listener so future
// disconnects auto-flush on reconnect. The flush is a fast no-op
// when the queue is empty.
startSyncQueueAutoFlush();

// Walk IndexedDB once on boot and refetch covers for any track /
// album / playlist saved before the no-cors `fetchCoverBlob`
// fix shipped (their `coverBlob` slot is `undefined` because the
// previous CORS-mode fetch was rejected silently). Best-effort,
// fire-and-forget — re-runs on every `online` event so a user
// who saved everything offline regains their covers as soon as
// they reconnect.
startCoverBackfill();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        {/* Cold-start splash sits OUTSIDE the router so it can paint
            instantly on first commit (before any data loaders even
            fire) and fade out a beat after the first paint completes.
            Subsequent in-session renders short-circuit inside the
            component (sessionStorage flag) so navigating between
            routes doesn't re-trigger it — only a real cold launch
            (PWA killed from the multitasking tray, fresh tab open)
            does. */}
        <SplashScreen />
        <AppRouter />
      </I18nProvider>
    </QueryClientProvider>
  </React.StrictMode>
);
