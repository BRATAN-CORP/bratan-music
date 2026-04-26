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
    <aside className="hidden w-60 shrink-0 flex-col border-r border-border bg-background py-6 lg:flex">
      <nav className="flex flex-col gap-0.5 px-3">
        {navItems.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-[var(--radius-md)] px-3 py-2 text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-secondary text-foreground'
                  : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
              }`
            }
          >
            <Icon size={16} />
            {label}
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}
