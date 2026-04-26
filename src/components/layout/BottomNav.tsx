import { NavLink } from 'react-router-dom';
import { Search, Library, User, Home } from 'lucide-react';

const navItems = [
  { to: '/', icon: Home, label: 'Главная' },
  { to: '/search', icon: Search, label: 'Поиск' },
  { to: '/library', icon: Library, label: 'Библиотека' },
  { to: '/profile', icon: User, label: 'Профиль' },
];

export function BottomNav() {
  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-40 flex h-16 items-center justify-around border-t border-border/70 bg-card/85 backdrop-blur-2xl lg:hidden"
      style={{
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
      }}
    >
      {navItems.map(({ to, icon: Icon, label }) => (
        <NavLink
          key={to}
          to={to}
          className={({ isActive }) =>
            `flex min-w-16 flex-col items-center gap-0.5 rounded-2xl px-3 py-2 text-xs font-semibold transition-colors ${
              isActive ? 'bg-primary/15 text-primary' : 'text-muted-foreground'
            }`
          }
        >
          <Icon size={20} />
          {label}
        </NavLink>
      ))}
    </nav>
  );
}
