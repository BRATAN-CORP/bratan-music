import { Link } from 'react-router-dom';
import { Menu, Moon, Search, Sun } from 'lucide-react';
import { useUiStore } from '@/store/ui';
import { Button } from '@/components/ui/Button';

export function Header() {
  const { theme, toggleTheme, toggleSidebar } = useUiStore();

  return (
    <header
      className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-border/70 bg-card/75 px-4 backdrop-blur-2xl"
    >
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={toggleSidebar} className="lg:hidden">
          <Menu size={20} />
        </Button>
        <Link to="/" className="hero-gradient-text text-lg font-black tracking-tight">
          BRATAN MUSIC
        </Link>
      </div>

      <div className="flex items-center gap-2">
        <Link
          to="/search"
          className="inline-flex h-10 w-10 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        >
          <Search size={20} />
        </Link>
        <Button
          onClick={toggleTheme}
          variant="ghost"
          size="icon"
        >
          {theme === 'dark' ? <Sun size={20} /> : <Moon size={20} />}
        </Button>
      </div>
    </header>
  );
}
