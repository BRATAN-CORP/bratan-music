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
      className="hidden w-64 flex-col border-r border-border/70 bg-card/55 py-5 backdrop-blur-2xl lg:flex"
    >
      <nav className="flex flex-col gap-2 px-3">
        {navItems.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-2xl px-4 py-3 text-sm font-semibold transition-all duration-200 ${
                isActive ? 'bg-primary text-primary-foreground shadow-[var(--shadow-glow)]' : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
              }`
            }
          >
            <Icon size={20} />
            {label}
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}
