import { Link, NavLink } from 'react-router-dom';
import { Search, Library, User, Home, Heart, ListMusic, Pin, Headphones, Sparkles } from 'lucide-react';
import { useUiStore } from '@/store/ui';
import { usePlaylistsList } from '@/hooks/useLibrary';
import { useT, type TranslationKey } from '@/i18n';

const navItems: { to: string; icon: typeof Home; labelKey: TranslationKey; fallback: string }[] = [
  { to: '/', icon: Home, labelKey: 'nav.home', fallback: 'Главная' },
  { to: '/search', icon: Search, labelKey: 'nav.search', fallback: 'Поиск' },
  { to: '/library', icon: Library, labelKey: 'nav.library', fallback: 'Библиотека' },
  { to: '/ai', icon: Sparkles, labelKey: 'nav.aiPlaylist', fallback: 'AI плейлист' },
  { to: '/rooms', icon: Headphones, labelKey: 'nav.rooms', fallback: 'Комнаты' },
  { to: '/profile', icon: User, labelKey: 'nav.profile', fallback: 'Профиль' },
];

export function Sidebar() {
  const { sidebarOpen } = useUiStore();
  const { data: playlists } = usePlaylistsList();
  const t = useT();

  if (!sidebarOpen) return null;

  // Pinned: ordered by recency (newest pinned first). "Liked" auto-pins so it's
  // always reachable in the sidebar even before the user pins it manually.
  const pinned = (playlists ?? [])
    .filter((p) => p.pinnedAt != null || p.isLiked)
    .sort((a, b) => {
      // Liked playlist always at the very top of the pinned list.
      if (a.isLiked) return -1;
      if (b.isLiked) return 1;
      return (b.pinnedAt ?? 0) - (a.pinnedAt ?? 0);
    });

  return (
    <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col self-start overflow-y-auto border-r border-border bg-background py-6 lg:flex">
      {/* Brand mark — only shown on desktop, where the sidebar is the
          home for both navigation and identity. The accent dot scales up
          on hover, mirroring the original Header micro-interaction. */}
      <Link
        to="/"
        className="group mb-6 flex items-center gap-2 px-6 text-sm font-semibold uppercase tracking-[0.22em] text-foreground"
      >
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--color-accent)] transition-transform duration-300 group-hover:scale-150" />
        Bratan&nbsp;Music
      </Link>
      <nav className="flex flex-col gap-0.5 px-3">
        {navItems.map(({ to, icon: Icon, labelKey, fallback }) => (
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
            {t(labelKey) || fallback}
          </NavLink>
        ))}
      </nav>

      {pinned.length > 0 && (
        <div className="mt-4 flex flex-col gap-1 px-3">
          <div className="flex items-center gap-1.5 px-3 pb-1 text-[10px] font-medium uppercase tracking-[0.2em] text-muted-foreground/80">
            <Pin size={10} />
            Закреплённые
          </div>
          {pinned.map((p) => (
            <NavLink
              key={p.id}
              to={`/playlist/${p.id}`}
              className={({ isActive }) =>
                `group flex items-center gap-3 rounded-[var(--radius-md)] px-3 py-1.5 text-sm transition-colors ${
                  isActive
                    ? 'bg-secondary text-foreground'
                    : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
                }`
              }
            >
              <span className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-[var(--radius-sm)] bg-secondary">
                {p.isLiked ? (
                  <Heart size={12} className="fill-[var(--color-accent)] text-[var(--color-accent)]" />
                ) : p.coverUrl ? (
                  <img src={p.coverUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  <ListMusic size={12} className="text-muted-foreground" />
                )}
              </span>
              <span className="min-w-0 flex-1 truncate">{p.isLiked ? 'Любимое' : p.name}</span>
            </NavLink>
          ))}
        </div>
      )}
    </aside>
  );
}
