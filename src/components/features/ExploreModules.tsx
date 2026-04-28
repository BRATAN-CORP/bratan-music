import { Link } from 'react-router-dom';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ListMusic, Loader2, Play, Sparkles } from 'lucide-react';
import { motion } from 'motion/react';
import type {
  ExploreModule,
  ExplorePlaylist,
  ExplorePageLink,
  Track,
} from '@/types';
import { AlbumCard } from './AlbumCard';
import { ArtistCard } from './ArtistCard';
import { TrackItem } from './TrackItem';
import { usePlayerStore } from '@/store/player';
import { api } from '@/lib/api';

interface ExploreModulesProps {
  modules: ExploreModule[];
}

/**
 * Renders an ordered list of normalised explore modules. Each
 * module variant has its own row layout — page links collapse to a
 * pill cloud, lists become horizontal scrollers with bleeding
 * gradient masks, etc.
 */
export function ExploreModules({ modules }: ExploreModulesProps) {
  return (
    <div className="flex flex-col gap-10">
      {modules.map((m, i) => (
        <ModuleRow key={`${m.type}-${i}-${m.title}`} module={m} />
      ))}
    </div>
  );
}

function ModuleRow({ module: m }: { module: ExploreModule }) {
  switch (m.type) {
    case 'pageLinks':
      return <PageLinksCloud title={m.title} items={m.items} />;
    case 'tracks':
      return <TrackListRow title={m.title} items={m.items} />;
    case 'albums':
      return <AlbumScroller title={m.title} items={m.items} />;
    case 'artists':
      return <ArtistScroller title={m.title} items={m.items} />;
    case 'playlists':
      return <PlaylistScroller title={m.title} items={m.items} />;
  }
}

function SectionHeader({ title, icon }: { title: string; icon?: React.ReactNode }) {
  if (!title) return null;
  return (
    <h2 className="flex items-center gap-2 text-base font-semibold tracking-tight">
      {icon}
      {title}
    </h2>
  );
}

function PageLinksCloud({ title, items }: { title: string; items: ExplorePageLink[] }) {
  return (
    <section className="flex flex-col gap-3">
      <SectionHeader title={title} icon={<Sparkles size={14} className="text-[var(--color-accent)]" />} />
      <div className="flex flex-wrap gap-2">
        {items.map((it, i) => (
          <motion.div
            key={it.slug}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: Math.min(i, 12) * 0.012, duration: 0.18 }}
          >
            <Link
              to={`/explore/${it.slug}`}
              className="inline-flex items-center rounded-[var(--radius-md)] border border-border bg-card px-3 py-2 text-sm transition-colors hover:bg-secondary"
            >
              {it.title}
            </Link>
          </motion.div>
        ))}
      </div>
    </section>
  );
}

function TrackListRow({ title, items }: { title: string; items: Track[] }) {
  const setTrack = usePlayerStore((s) => s.setTrack);
  const setQueue = usePlayerStore((s) => s.setQueue);
  // Reuse the standard TrackItem so play/pause sync, like and the
  // overflow menu behave identically to other lists. Tapping any
  // row queues the entire module so prev/next continues through the
  // editorial selection.
  const handlePlay = (track: Track) => {
    setQueue(items);
    setTrack({
      id: track.id,
      title: track.title,
      artist: track.artist,
      artistId: track.artistId,
      coverUrl: track.coverUrl,
      coverVideoUrl: track.coverVideoUrl,
      duration: track.duration,
    });
  };
  return (
    <section className="flex flex-col gap-3">
      <SectionHeader title={title} />
      <div className="rounded-[var(--radius-md)] border border-border bg-background">
        {items.slice(0, 8).map((t, i) => (
          <TrackItem key={t.id} track={t} index={i} onPlay={handlePlay} />
        ))}
      </div>
    </section>
  );
}

function HorizontalScroller({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <SectionHeader title={title} />
      <div
        className="-mx-4 overflow-x-auto px-4 pb-2 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden sm:-mx-6 sm:px-6 lg:-mx-10 lg:px-10"
      >
        <div className="flex gap-4">
          {children}
        </div>
      </div>
    </section>
  );
}

function AlbumScroller({ title, items }: { title: string; items: import('@/types').Album[] }) {
  return (
    <HorizontalScroller title={title}>
      {items.map((a) => (
        <div key={a.id} className="w-[160px] shrink-0 sm:w-[180px]">
          <AlbumCard album={a} />
        </div>
      ))}
    </HorizontalScroller>
  );
}

function ArtistScroller({ title, items }: { title: string; items: import('@/types').Artist[] }) {
  return (
    <HorizontalScroller title={title}>
      {items.map((a) => (
        <div key={a.id} className="w-[140px] shrink-0 sm:w-[160px]">
          <ArtistCard artist={a} />
        </div>
      ))}
    </HorizontalScroller>
  );
}

function PlaylistScroller({ title, items }: { title: string; items: ExplorePlaylist[] }) {
  return (
    <HorizontalScroller title={title}>
      {items.map((p) => (
        <div key={p.id} className="w-[180px] shrink-0 sm:w-[200px]">
          <ExplorePlaylistCard playlist={p} />
        </div>
      ))}
    </HorizontalScroller>
  );
}

function ExplorePlaylistCard({ playlist }: { playlist: ExplorePlaylist }) {
  const setTrack = usePlayerStore((s) => s.setTrack);
  const setQueue = usePlayerStore((s) => s.setQueue);
  const queryClient = useQueryClient();
  const [loading, setLoading] = useState(false);

  const handlePlay = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (loading) return;
    try {
      setLoading(true);
      // Fetch on demand instead of per-card on mount — a row of 15
      // playlists would otherwise fire 15 round-trips just to render.
      const res = await queryClient.fetchQuery({
        queryKey: ['explore-playlist-tracks', playlist.id],
        queryFn: () => api.get<{ items: Track[] }>(`/explore/playlists/${playlist.id}/tracks`),
        staleTime: 1000 * 60 * 10,
      });
      const items = res.items;
      const first = items?.[0];
      if (!items || !first) return;
      setQueue(items);
      setTrack({
        id: first.id,
        title: first.title,
        artist: first.artist,
        artistId: first.artistId,
        coverUrl: first.coverUrl,
        coverVideoUrl: first.coverVideoUrl,
        duration: first.duration,
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="group flex flex-col gap-2.5">
      <div className="relative aspect-square w-full overflow-hidden rounded-[var(--radius-md)] border border-border bg-secondary">
        {playlist.coverUrl ? (
          <img
            src={playlist.coverUrl}
            alt={playlist.title}
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <ListMusic size={28} className="text-muted-foreground" />
          </div>
        )}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
        <button
          type="button"
          onClick={handlePlay}
          aria-label={`Воспроизвести ${playlist.title}`}
          className="absolute bottom-2 right-2 flex h-9 w-9 translate-y-3 items-center justify-center rounded-full bg-[var(--color-accent)] text-[var(--color-text-on-accent)] opacity-0 shadow-lg transition-all duration-300 group-hover:translate-y-0 group-hover:opacity-100"
        >
          {loading ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} fill="currentColor" />}
        </button>
      </div>
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{playlist.title}</p>
        <p className="truncate text-xs text-muted-foreground">
          {playlist.curator ?? 'Tidal'}
          {typeof playlist.trackCount === 'number' ? ` · ${playlist.trackCount} треков` : ''}
        </p>
      </div>
    </div>
  );
}
