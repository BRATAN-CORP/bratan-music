import { Link } from 'react-router-dom';
import { Menu, Moon, Search, Sun } from 'lucide-react';
import { useUiStore } from '@/store/ui';
import { Button } from '@/components/ui/Button';

export function Header() {
  const { theme, toggleTheme, toggleSidebar } = useUiStore();

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-border bg-background px-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={toggleSidebar} className="lg:hidden">
          <Menu size={18} />
        </Button>
        <Link to="/" className="text-sm font-semibold uppercase tracking-[0.2em] text-foreground">
          Bratan&nbsp;Music
        </Link>
      </div>

      <div className="flex items-center gap-1">
        <Link
          to="/search"
          className="inline-flex h-9 w-9 items-center justify-center rounded-[var(--radius-md)] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        >
          <Search size={18} />
        </Link>
        <Button onClick={toggleTheme} variant="ghost" size="icon" aria-label="Сменить тему">
          {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
        </Button>
      </div>
    </header>
  );
}
