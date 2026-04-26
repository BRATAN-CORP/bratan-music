import { Link } from 'react-router-dom';
import { Menu, Moon, Search, Sun } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useUiStore } from '@/store/ui';
import { Button } from '@/components/ui/Button';

export function Header() {
  const { theme, toggleTheme, toggleSidebar } = useUiStore();

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-border glass px-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={toggleSidebar} className="lg:hidden">
          <Menu size={18} />
        </Button>
        <Link to="/" className="group flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.22em] text-foreground">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--color-accent)] transition-transform duration-300 group-hover:scale-150" />
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
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={theme}
              initial={{ rotate: -45, opacity: 0 }}
              animate={{ rotate: 0, opacity: 1 }}
              exit={{ rotate: 45, opacity: 0 }}
              transition={{ duration: 0.25 }}
              className="inline-flex"
            >
              {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
            </motion.span>
          </AnimatePresence>
        </Button>
      </div>
    </header>
  );
}
