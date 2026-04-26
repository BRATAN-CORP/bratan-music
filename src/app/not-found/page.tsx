import { Link } from 'react-router-dom';
import { Home } from 'lucide-react';
import { Button } from '@/components/ui/Button';

export function NotFoundPage() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
      <p className="hero-gradient-text text-7xl font-black">404</p>
      <h1 className="text-2xl font-bold">Страница не найдена</h1>
      <p className="text-sm text-muted-foreground">
        Возможно, она была удалена или вы ввели неверный адрес
      </p>
      <Link to="/" className="mt-2">
        <Button>
          <Home size={16} />
          На главную
        </Button>
      </Link>
    </div>
  );
}
