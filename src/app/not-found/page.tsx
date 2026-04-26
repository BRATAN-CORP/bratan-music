import { Link } from 'react-router-dom';
import { Home } from 'lucide-react';

export function NotFoundPage() {
  return (
    <div className="flex flex-col items-center justify-center flex-1 p-8 text-center gap-4">
      <p className="text-6xl font-bold" style={{ color: 'var(--color-accent)' }}>404</p>
      <h1 className="text-2xl font-bold">Страница не найдена</h1>
      <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
        Возможно, она была удалена или вы ввели неверный адрес
      </p>
      <Link
        to="/"
        className="flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-medium mt-2"
        style={{ backgroundColor: 'var(--color-accent)', color: 'var(--color-text-on-accent)' }}
      >
        <Home size={16} />
        На главную
      </Link>
    </div>
  );
}
