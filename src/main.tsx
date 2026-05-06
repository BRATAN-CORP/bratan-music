import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { AppRouter } from '@/app/router';
import { getTelegramWebApp } from '@/hooks/useAuth';
import { I18nProvider } from '@/i18n';
import { queryClient } from '@/lib/queryClient';
import { wireOfflineBridge } from '@/store/offline';
import { startSyncQueueAutoFlush } from '@/lib/offline/syncQueue';
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

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <AppRouter />
      </I18nProvider>
    </QueryClientProvider>
  </React.StrictMode>
);
