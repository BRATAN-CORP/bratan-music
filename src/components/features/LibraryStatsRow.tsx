import { motion } from 'motion/react';
import { ListMusic, Disc3, User as UserIcon, Download, type LucideIcon } from 'lucide-react';
import { useT } from '@/i18n';
import { cn } from '@/lib/utils';

interface StatCardProps {
  icon: LucideIcon;
  value: number;
  label: string;
  /** Click hop — switch to the matching tab. */
  onClick?: () => void;
  /** Stagger index for the entrance animation. */
  index: number;
  /** Highlight ring when this is the active tab. */
  active?: boolean;
}

function StatCard({ icon: Icon, value, label, onClick, index, active }: StatCardProps) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.05 * index, ease: [0.16, 1, 0.3, 1] }}
      whileHover={{ y: -3 }}
      whileTap={{ scale: 0.97 }}
      className={cn(
        'liquid-glass liquid-glass--soft group relative flex flex-col gap-1 rounded-[var(--radius-lg)] p-4 text-left transition-all',
        // The active tab gets an accent-coloured ring AND a brighter
        // value tint so the user immediately sees which stat the
        // current tab corresponds to.
        active
          ? 'ring-2 ring-[var(--color-accent)] ring-offset-2 ring-offset-background'
          : 'hover:ring-1 hover:ring-[var(--color-border-strong)]',
      )}
    >
      <div className="flex items-center justify-between">
        <span
          className={cn(
            'flex h-9 w-9 items-center justify-center rounded-full bg-[var(--color-bg-muted)] transition-colors',
            active
              ? 'text-[var(--color-accent)]'
              : 'text-muted-foreground group-hover:text-foreground',
          )}
        >
          <Icon size={18} />
        </span>
      </div>
      <p
        className={cn(
          'text-3xl font-semibold tabular-nums tracking-tight transition-colors sm:text-4xl',
          active ? 'text-[var(--color-accent)]' : 'text-foreground',
        )}
      >
        {value}
      </p>
      <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">{label}</p>
    </motion.button>
  );
}

interface LibraryStatsRowProps {
  playlistsCount: number;
  albumsCount: number;
  artistsCount: number;
  downloadedCount: number;
  activeTab: 'playlists' | 'albums' | 'artists' | 'downloaded';
  onSelectTab: (tab: 'playlists' | 'albums' | 'artists' | 'downloaded') => void;
}

/**
 * Four-up stats grid sitting below the Library hero. Each card shows
 * the count for one of the four library tabs and acts as a quick
 * shortcut — clicking a stat hops to that tab. The active tab is
 * highlighted with an accent ring so the row also doubles as a
 * legend for "where am I right now".
 */
export function LibraryStatsRow({
  playlistsCount,
  albumsCount,
  artistsCount,
  downloadedCount,
  activeTab,
  onSelectTab,
}: LibraryStatsRowProps) {
  const t = useT();
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
      <StatCard
        icon={ListMusic}
        value={playlistsCount}
        label={t('library.statPlaylists')}
        onClick={() => onSelectTab('playlists')}
        active={activeTab === 'playlists'}
        index={0}
      />
      <StatCard
        icon={Disc3}
        value={albumsCount}
        label={t('library.statAlbums')}
        onClick={() => onSelectTab('albums')}
        active={activeTab === 'albums'}
        index={1}
      />
      <StatCard
        icon={UserIcon}
        value={artistsCount}
        label={t('library.statArtists')}
        onClick={() => onSelectTab('artists')}
        active={activeTab === 'artists'}
        index={2}
      />
      <StatCard
        icon={Download}
        value={downloadedCount}
        label={t('library.statDownloaded')}
        onClick={() => onSelectTab('downloaded')}
        active={activeTab === 'downloaded'}
        index={3}
      />
    </div>
  );
}
