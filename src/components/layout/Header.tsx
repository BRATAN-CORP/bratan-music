import { Link } from 'react-router-dom';
import { Search } from 'lucide-react';

export function Header() {

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-border glass px-4">
      <div className="flex items-center gap-2">
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
      </div>
    </header>
  );
}
