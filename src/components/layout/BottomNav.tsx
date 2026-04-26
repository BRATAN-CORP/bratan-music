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
      className="fixed bottom-0 left-0 right-0 z-40 flex h-14 items-center justify-around border-t border-border bg-background lg:hidden"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      {navItems.map(({ to, icon: Icon, label }) => (
        <NavLink
          key={to}
          to={to}
          end={to === '/'}
          className={({ isActive }) =>
            `flex min-w-[60px] flex-col items-center gap-0.5 px-2 py-1 text-[11px] font-medium transition-colors ${
              isActive ? 'text-foreground' : 'text-muted-foreground'
            }`
          }
        >
          <Icon size={18} />
          {label}
        </NavLink>
      ))}
    </nav>
  );
}
