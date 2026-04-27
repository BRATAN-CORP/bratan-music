import { NavLink } from 'react-router-dom';
import { Search, Library, User, Home } from 'lucide-react';
import { usePlayerStore } from '@/store/player';

const navItems = [
  { to: '/', icon: Home, label: 'Главная' },
  { to: '/search', icon: Search, label: 'Поиск' },
  { to: '/library', icon: Library, label: 'Библиотека' },
  { to: '/profile', icon: User, label: 'Профиль' },
];

export function BottomNav() {
  const fullscreen = usePlayerStore((s) => s.fullscreen);
  const playerVisible = usePlayerStore((s) => Boolean(s.currentTrack));
  if (fullscreen) return null;
  // When the mini-player is visible the bottom nav is glued to its bottom edge:
  // top corners stay flat so the two surfaces read as one floating glass card.
  // Without the player it stands alone with all four corners rounded.
  const cornerCx = playerVisible
    ? 'rounded-t-none rounded-b-[var(--radius-xl)] border-t-0 no-lip'
    : 'rounded-[var(--radius-xl)]';
  return (
    <nav
      className={`fixed bottom-[calc(env(safe-area-inset-bottom,0px)+0.5rem)] left-2 right-2 z-40 flex justify-around overflow-hidden liquid-glass pt-2 lg:hidden ${cornerCx}`}
      style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) * 0 + 8px)' }}
    >
      {navItems.map(({ to, icon: Icon, label }) => (
        <NavLink
          key={to}
          to={to}
          end={to === '/'}
          className={({ isActive }) =>
            `relative flex min-w-[60px] flex-col items-center gap-0.5 px-2 py-1 text-[11px] font-medium transition-colors ${
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
