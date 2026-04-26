import { NavLink } from 'react-router-dom';
import { Search, Library, User, Home } from 'lucide-react';
import { useUiStore } from '@/store/ui';

const navItems = [
  { to: '/', icon: Home, label: 'Главная' },
  { to: '/search', icon: Search, label: 'Поиск' },
  { to: '/library', icon: Library, label: 'Библиотека' },
  { to: '/profile', icon: User, label: 'Профиль' },
];

export function Sidebar() {
  const { sidebarOpen } = useUiStore();

  if (!sidebarOpen) return null;

  return (
    <aside
      className="hidden lg:flex flex-col w-56 border-r py-4"
      style={{
        backgroundColor: 'var(--color-surface)',
        borderColor: 'var(--color-border)',
      }}
    >
      <nav className="flex flex-col gap-1 px-2">
        {navItems.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                isActive ? 'font-medium' : ''
              }`
            }
            style={({ isActive }) => ({
              backgroundColor: isActive ? 'var(--color-accent-muted)' : 'transparent',
              color: isActive ? 'var(--color-accent)' : 'var(--color-text-muted)',
            })}
          >
            <Icon size={20} />
            {label}
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}
