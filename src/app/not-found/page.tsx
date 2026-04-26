import { Link } from 'react-router-dom';
import { Home } from 'lucide-react';
import { Button } from '@/components/ui/Button';

export function NotFoundPage() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-10 text-center">
      <p className="text-6xl font-semibold tracking-tight">404</p>
      <h1 className="text-lg font-medium">Страница не найдена</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        Возможно, она была удалена или вы ввели неверный адрес.
      </p>
      <Link to="/" className="mt-2">
        <Button variant="outline">
          <Home size={14} />
          На главную
        </Button>
      </Link>
    </div>
  );
}
