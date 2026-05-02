import { AlertTriangle, RefreshCw } from 'lucide-react';
import { useT } from '@/i18n';

interface ErrorFallbackProps {
  message?: string;
  onRetry?: () => void;
}

export function ErrorFallback({ message, onRetry }: ErrorFallbackProps) {
  const t = useT();
  return (
    <div className="flex flex-col items-center justify-center py-16 px-6 text-center gap-4">
      <AlertTriangle size={40} style={{ color: 'var(--color-danger)' }} />
      <p className="text-lg font-medium">{message ?? t('errors.generic')}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium"
          style={{ backgroundColor: 'var(--color-bg-muted)', color: 'var(--color-text)' }}
        >
          <RefreshCw size={16} />
          {t('errors.tryAgain')}
        </button>
      )}
    </div>
  );
}
