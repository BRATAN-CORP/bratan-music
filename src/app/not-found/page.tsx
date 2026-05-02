import { Link } from 'react-router-dom';
import { Home } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useT } from '@/i18n';

export function NotFoundPage() {
  const t = useT();
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-10 text-center">
      <p className="text-6xl font-semibold tracking-tight">{t('not_found.code')}</p>
      <h1 className="text-lg font-medium">{t('not_found.title')}</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        {t('not_found.hint')}
      </p>
      <Link to="/" className="mt-2">
        <Button variant="outline">
          <Home size={14} />
          {t('not_found.goHome')}
        </Button>
      </Link>
    </div>
  );
}
