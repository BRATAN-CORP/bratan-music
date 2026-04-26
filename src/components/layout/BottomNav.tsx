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
      className="lg:hidden fixed bottom-0 left-0 right-0 flex items-center justify-around h-14 border-t z-40"
      style={{
        backgroundColor: 'var(--color-surface)',
        borderColor: 'var(--color-border)',
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
      }}
    >
      {navItems.map(({ to, icon: Icon, label }) => (
        <NavLink
          key={to}
          to={to}
          className="flex flex-col items-center gap-0.5 py-1 px-3 text-xs"
          style={({ isActive }) => ({
            color: isActive ? 'var(--color-accent)' : 'var(--color-text-subtle)',
          })}
        >
          <Icon size={20} />
          {label}
        </NavLink>
      ))}
    </nav>
  );
}
