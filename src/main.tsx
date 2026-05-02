import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { AppRouter } from '@/app/router';
import { getTelegramWebApp } from '@/hooks/useAuth';
import { I18nProvider } from '@/i18n';
import { queryClient } from '@/lib/queryClient';
import '@/styles/globals.scss';

getTelegramWebApp()?.ready?.();
getTelegramWebApp()?.expand?.();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <AppRouter />
      </I18nProvider>
    </QueryClientProvider>
  </React.StrictMode>
);
