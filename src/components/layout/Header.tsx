import { Link } from 'react-router-dom';
import { Search, Sun, Moon, Menu } from 'lucide-react';
import { useUiStore } from '@/store/ui';

export function Header() {
  const { theme, toggleTheme, toggleSidebar } = useUiStore();

  return (
    <header
      className="flex items-center justify-between px-4 h-14 border-b"
      style={{
        backgroundColor: 'var(--color-surface)',
        borderColor: 'var(--color-border)',
      }}
    >
      <div className="flex items-center gap-3">
        <button onClick={toggleSidebar} className="lg:hidden p-2 rounded-lg hover:opacity-80">
          <Menu size={20} />
        </button>
        <Link to="/" className="font-bold text-lg" style={{ color: 'var(--color-accent)' }}>
          BRATAN MUSIC
        </Link>
      </div>

      <div className="flex items-center gap-2">
        <Link
          to="/search"
          className="p-2 rounded-lg hover:opacity-80"
          style={{ color: 'var(--color-text-muted)' }}
        >
          <Search size={20} />
        </Link>
        <button
          onClick={toggleTheme}
          className="p-2 rounded-lg hover:opacity-80"
          style={{ color: 'var(--color-text-muted)' }}
        >
          {theme === 'dark' ? <Sun size={20} /> : <Moon size={20} />}
        </button>
      </div>
    </header>
  );
}
