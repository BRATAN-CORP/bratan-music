import { Link } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CalendarRange, ChevronLeft, ChevronRight, ListMusic, Loader2, Play, Sparkles } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
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
import { tidalImageUrl } from '@/lib/tidal-image';

interface ExploreModulesProps {
  modules: ExploreModule[];
  /**
   * When true, the FIRST `pageLinks` row is rendered as a tall
   * "hero" grid of image-backed genre tiles instead of the standard
   * pill cloud. This is the layout we use on the top-level /explore
   * page where the first row is "Genres" and benefits from the
   * extra visual weight.
   */
  heroFirstPageLinks?: boolean;
  /**
   * When true, the FIRST `playlists` row uses a larger, more
   * editorial card layout (≥240 px tiles) — matches Tidal's own
   * "Featured" treatment. Subsequent playlist rows fall back to
   * the standard horizontal scroller.
   */
  heroFirstPlaylists?: boolean;
}

/**
 * Renders an ordered list of normalised explore modules. Each
 * module variant has its own row layout — rich image grids for the
 * top genre cloud, mixed-size scrollers for editorial playlists,
 * standard horizontal scrollers for albums/artists, and a vertical
 * track list for editorial singles selections.
 */
export function ExploreModules({
  modules,
  heroFirstPageLinks = true,
  heroFirstPlaylists = true,
}: ExploreModulesProps) {
  // Track whether we've already used up the "first hero" slot for
  // each module type so we apply hero treatment once and once only,
  // even if the API emits multiple page-link rows or several
  // playlist rows.
  let usedHeroPageLinks = false;
  let usedHeroPlaylists = false;
  return (
    <div className="flex flex-col gap-10">
      {modules.map((m, i) => {
        let hero = false;
        if (m.type === 'pageLinks' && heroFirstPageLinks && !usedHeroPageLinks) {
          hero = true;
          usedHeroPageLinks = true;
        }
        if (m.type === 'playlists' && heroFirstPlaylists && !usedHeroPlaylists) {
          hero = true;
          usedHeroPlaylists = true;
        }
        return <ModuleRow key={`${m.type}-${i}-${m.title}`} module={m} hero={hero} />;
      })}
    </div>
  );
}

function ModuleRow({ module: m, hero }: { module: ExploreModule; hero: boolean }) {
  switch (m.type) {
    case 'pageLinks':
      // Tidal returns a mix of icon-only links (e.g. "Mood &
      // Activity" bullets) and image-backed links (genres). When
      // every item carries an imageId we can render a rich tile
      // grid; otherwise we fall back to the compact pill cloud so
      // an icon-only row doesn't get awkwardly large empty cards.
      {
        const allHaveImage = m.items.length > 0 && m.items.every((it) => Boolean(it.imageId));
        if (hero && allHaveImage) {
          return <PageLinksHeroGrid title={m.title} items={m.items} />;
        }
        if (allHaveImage) {
          return <PageLinksImageRow title={m.title} items={m.items} />;
        }
        return <PageLinksCloud title={m.title} items={m.items} />;
      }
    case 'tracks':
      return <TrackListRow title={m.title} items={m.items} />;
    case 'albums':
      return <AlbumScroller title={m.title} items={m.items} />;
    case 'artists':
      return <ArtistScroller title={m.title} items={m.items} />;
    case 'playlists':
      return <PlaylistScroller title={m.title} items={m.items} hero={hero} />;
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

/**
 * Hero treatment for the top-level "Genres" row on /explore. Renders
 * a 2- or 3-column responsive grid of tall image tiles with a soft
 * gradient + title overlay — the same visual rhythm Tidal's own
 * Explore landing uses, adapted to our spacing tokens. Because grids
 * wrap onto multiple lines, no horizontal scroll is needed: the
 * whole genre taxonomy is visible at a glance.
 */
function PageLinksHeroGrid({ title, items }: { title: string; items: ExplorePageLink[] }) {
  return (
    <section className="flex flex-col gap-4">
      <SectionHeader title={title} icon={<Sparkles size={14} className="text-[var(--color-accent)]" />} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {items.map((it, i) => (
          <GenreTile key={it.slug} item={it} index={i} variant="hero" />
        ))}
      </div>
    </section>
  );
}

/**
 * Standard image-backed row for non-hero pageLinks (e.g. moods /
 * decades after the hero genres row, or any pageLinks list rendered
 * inside a sub-page). Horizontal scroller with snap so swiping on
 * mobile feels deliberate.
 */
function PageLinksImageRow({ title, items }: { title: string; items: ExplorePageLink[] }) {
  return (
    <SnapScroller title={title}>
      {items.map((it, i) => (
        <div key={it.slug} className="w-[160px] shrink-0 snap-start sm:w-[180px]">
          <GenreTile item={it} index={i} variant="row" />
        </div>
      ))}
    </SnapScroller>
  );
}

function GenreTile({
  item,
  index,
  variant,
}: {
  item: ExplorePageLink;
  index: number;
  variant: 'hero' | 'row';
}) {
  // Larger CDN size on hero tiles so they stay crisp on retina
  // screens; row tiles stay at 480 to keep payloads light.
  const img = tidalImageUrl(item.imageId, variant === 'hero' ? 640 : 480);
  // Decades and a handful of mood pages don't ship with cover images,
  // and the previous fallback was a thin diagonal gradient that read
  // as "broken card". When there's no image we render the same
  // shape as the landing-page "Что внутри" feature card: a solid
  // surface with an icon mark + label, plus a hover-revealed
  // accent-glow blob blurring under the icon. This keeps a missing
  // image from ever looking like a layout bug.
  const isDecade = /\b(19|20)\d0s?\b/i.test(item.title) || item.slug.toLowerCase().includes('decade');
  const FallbackIcon = isDecade ? CalendarRange : Sparkles;
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index, 12) * 0.025, duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
      className="group"
    >
      <Link
        to={`/explore/${item.slug}`}
        className={
          'relative block w-full overflow-hidden rounded-[var(--radius-md)] border border-border bg-card transition-all duration-300 will-change-transform hover:-translate-y-0.5 hover:border-[var(--color-border-strong)] hover:shadow-xl ' +
          (variant === 'hero' ? 'aspect-[4/5]' : 'aspect-square')
        }
      >
        {/* Hover accent-glow blob — same recipe as the landing page's
            feature cards. Lives behind the content layer so the icon
            mark and label visibly catch its glow on hover. */}
        <div
          aria-hidden
          className="pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full opacity-0 blur-3xl transition-opacity duration-500 group-hover:opacity-100"
          style={{
            background:
              'radial-gradient(circle, var(--color-accent-glow) 0%, transparent 70%)',
          }}
        />
        {img ? (
          <>
            <img
              src={img}
              alt={item.title}
              loading="lazy"
              className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.06]"
            />
            <div
              className={
                'absolute inset-0 ' +
                (variant === 'hero'
                  ? 'bg-gradient-to-t from-black/75 via-black/15 to-black/0'
                  : 'bg-gradient-to-t from-black/65 via-black/10 to-black/0')
              }
            />
            <div className="absolute inset-x-0 bottom-0 flex flex-col gap-0.5 p-3">
              <span className="text-[11px] font-medium uppercase tracking-[0.2em] text-white/60">
                {variant === 'hero' ? 'Жанр' : 'Подборка'}
              </span>
              <span className="line-clamp-2 text-sm font-semibold text-white sm:text-base">
                {item.title}
              </span>
            </div>
          </>
        ) : (
          <div className="relative flex h-full w-full flex-col justify-between p-4">
            <div
              className="flex h-9 w-9 items-center justify-center rounded-[var(--radius-sm)] border border-border bg-background text-foreground"
            >
              <FallbackIcon size={16} className="text-[var(--color-accent)]" />
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
                {isDecade ? 'Декада' : 'Подборка'}
              </span>
              <span className="line-clamp-2 text-base font-semibold tracking-tight">
                {item.title}
              </span>
            </div>
          </div>
        )}
      </Link>
    </motion.div>
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
              className="inline-flex items-center rounded-full border border-border bg-card px-4 py-1.5 text-sm transition-colors hover:border-[var(--color-accent-soft)] hover:bg-secondary"
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

/**
 * Snap-scrolling horizontal row used by every "card scroller" on
 * Explore (albums / artists / playlists / image-backed pageLinks).
 *
 * UX details:
 * - CSS `scroll-snap-type: x mandatory` so cards land cleanly when
 *   the user flicks. Mobile swipe is the primary input on this
 *   surface; momentum scrolling does the rest natively.
 * - Soft fade masks at the left/right edges so the row reads as
 *   "scrollable content" instead of getting hard-clipped at the
 *   container border.
 * - Desktop-only chevron buttons positioned over the edges that
 *   advance ~80% of the viewport on click. They appear/hide based
 *   on whether more content exists in that direction so we don't
 *   leave a phantom button at the start/end of the row.
 */
function SnapScroller({ title, children }: { title: string; children: React.ReactNode }) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [canPrev, setCanPrev] = useState(false);
  const [canNext, setCanNext] = useState(false);
  // Desktop click-and-drag state. We track whether a drag is in
  // progress so child links can be suppressed if the user actually
  // dragged (vs. clicked-without-moving). `dragMovedRef` is a ref
  // because the click handler runs synchronously after pointerup
  // and React state batching would race the value.
  const dragStateRef = useRef<{
    pointerId: number;
    startX: number;
    startScroll: number;
    moved: boolean;
  } | null>(null);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const update = () => {
      // 1px tolerance covers fractional sub-pixel scrollLeft values
      // some browsers report when content fits exactly.
      setCanPrev(el.scrollLeft > 1);
      setCanNext(el.scrollLeft + el.clientWidth + 1 < el.scrollWidth);
    };
    // Initial measure happens on the next frame so the row's children
    // have laid out their final width — without this the chevrons
    // briefly flash on first paint when the row genuinely doesn't
    // overflow yet.
    const raf = requestAnimationFrame(update);
    el.addEventListener('scroll', update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    // Also observe each child so chevrons re-evaluate when card
    // images load (their layout width is finalised post-image
    // decode and ResizeObserver on the row alone may miss this on
    // some browsers).
    const items = el.firstElementChild?.children;
    if (items) {
      Array.from(items).forEach((c) => ro.observe(c));
    }
    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener('scroll', update);
      ro.disconnect();
    };
  }, []);

  const step = (direction: 1 | -1) => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollBy({ left: direction * el.clientWidth * 0.8, behavior: 'smooth' });
  };

  // Mouse drag-to-scroll on desktop. We deliberately scope the drag
  // initiator to the mouse button: touch users get the native flick
  // momentum scroll and we'd just fight it by hijacking pointer
  // events here. On pointerdown we capture the pointer and listen
  // for moves on the document so the drag survives the cursor
  // crossing the scroller edge.
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== 'mouse') return;
    const el = scrollerRef.current;
    if (!el) return;
    dragStateRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startScroll: el.scrollLeft,
      moved: false,
    };
    try { el.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragStateRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    const el = scrollerRef.current;
    if (!el) return;
    const dx = e.clientX - drag.startX;
    if (!drag.moved && Math.abs(dx) > 4) drag.moved = true;
    el.scrollLeft = drag.startScroll - dx;
  };
  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragStateRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    const el = scrollerRef.current;
    if (el) {
      try { el.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    }
    // Clear after a microtask so the click handler that runs after
    // pointerup can still see `moved` to suppress link navigation.
    const wasMoved = drag.moved;
    setTimeout(() => {
      if (dragStateRef.current === drag) dragStateRef.current = null;
    }, 0);
    if (wasMoved) {
      // Suppress the synthetic click that fires after a drag-release.
      // Without this the user's drag-to-scroll would also activate
      // whatever link/card their cursor happens to be over.
      const suppress = (ev: MouseEvent) => {
        ev.preventDefault();
        ev.stopPropagation();
        document.removeEventListener('click', suppress, true);
      };
      document.addEventListener('click', suppress, true);
      // Defensive removal in case no click ever fires.
      setTimeout(() => document.removeEventListener('click', suppress, true), 200);
    }
  };

  return (
    <section className="relative flex flex-col gap-3">
      <SectionHeader title={title} />
      <div className="relative">
        <div
          ref={scrollerRef}
          className="-mx-4 overflow-x-auto overflow-y-hidden px-4 pb-2 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden sm:-mx-6 sm:px-6 lg:-mx-10 lg:px-10 cursor-grab active:cursor-grabbing"
          style={{
            scrollSnapType: 'x mandatory',
            scrollPaddingLeft: 16,
            scrollPaddingRight: 16,
            // Soft horizontal mask so cards near the gutter dissolve
            // into the page background instead of getting hard-clipped
            // — fixes the "rough crop on PC" the user reported on
            // album / playlist scrollers.
            WebkitMaskImage:
              'linear-gradient(to right, transparent 0, black 12px, black calc(100% - 12px), transparent 100%)',
            maskImage:
              'linear-gradient(to right, transparent 0, black 12px, black calc(100% - 12px), transparent 100%)',
          }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          <div className="flex gap-4">{children}</div>
        </div>

        {/* Desktop scroll affordances. Hidden on touch (< md) where
            swipe is the natural input. Each chevron only renders
            when there's actually content to reach in that direction
            — `canPrev` / `canNext` are recomputed on scroll, on
            container resize AND on every child resize so a partial
            measure during image decode doesn't leave a phantom
            chevron at the edges of a fully-visible row. */}
        {canPrev && (
          <button
            type="button"
            aria-label="Назад"
            onClick={() => step(-1)}
            className="absolute left-0 top-1/2 hidden h-10 w-10 -translate-y-1/2 -translate-x-1 items-center justify-center rounded-full border border-border bg-background/80 text-foreground shadow-lg backdrop-blur-md transition-colors hover:bg-background md:flex"
          >
            <ChevronLeft size={18} />
          </button>
        )}
        {canNext && (
          <button
            type="button"
            aria-label="Далее"
            onClick={() => step(1)}
            className="absolute right-0 top-1/2 hidden h-10 w-10 -translate-y-1/2 translate-x-1 items-center justify-center rounded-full border border-border bg-background/80 text-foreground shadow-lg backdrop-blur-md transition-colors hover:bg-background md:flex"
          >
            <ChevronRight size={18} />
          </button>
        )}
      </div>
    </section>
  );
}

function AlbumScroller({ title, items }: { title: string; items: import('@/types').Album[] }) {
  return (
    <SnapScroller title={title}>
      {items.map((a) => (
        <div key={a.id} className="w-[160px] shrink-0 snap-start sm:w-[180px]">
          <AlbumCard album={a} />
        </div>
      ))}
    </SnapScroller>
  );
}

function ArtistScroller({ title, items }: { title: string; items: import('@/types').Artist[] }) {
  return (
    <SnapScroller title={title}>
      {items.map((a) => (
        <div key={a.id} className="w-[140px] shrink-0 snap-start sm:w-[160px]">
          <ArtistCard artist={a} />
        </div>
      ))}
    </SnapScroller>
  );
}

function PlaylistScroller({ title, items, hero }: { title: string; items: ExplorePlaylist[]; hero: boolean }) {
  // Hero playlist row gets larger tiles and a richer card layout
  // (description + curator badge). Subsequent playlist rows use the
  // standard compact card so we don't drown the page in 240-px
  // tiles when Tidal returns multiple playlist sections.
  const cardWidth = hero ? 'w-[220px] sm:w-[260px]' : 'w-[180px] sm:w-[200px]';
  return (
    <SnapScroller title={title}>
      {items.map((p) => (
        <div key={p.id} className={`shrink-0 snap-start ${cardWidth}`}>
          <ExplorePlaylistCard playlist={p} variant={hero ? 'hero' : 'compact'} />
        </div>
      ))}
    </SnapScroller>
  );
}

function ExplorePlaylistCard({
  playlist,
  variant,
}: {
  playlist: ExplorePlaylist;
  variant: 'hero' | 'compact';
}) {
  const setTrack = usePlayerStore((s) => s.setTrack);
  const setQueue = usePlayerStore((s) => s.setQueue);
  const queryClient = useQueryClient();
  const [loading, setLoading] = useState(false);
  const reduce = useReducedMotion();

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
    <motion.div
      whileHover={reduce ? undefined : { y: -2 }}
      transition={{ duration: 0.18 }}
      className="group flex flex-col gap-2.5"
    >
      <div className="relative aspect-square w-full overflow-hidden rounded-[var(--radius-md)] border border-border bg-secondary shadow-sm transition-shadow duration-300 group-hover:shadow-xl">
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
        {variant === 'hero' && (
          // Soft top→bottom gradient so the curator badge below
          // stays readable on busy artwork.
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/55 via-black/15 to-transparent" />
        )}
        {variant === 'hero' && playlist.curator && (
          <span className="pointer-events-none absolute left-2 top-2 rounded-full bg-black/55 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.18em] text-white/90 backdrop-blur-sm">
            {playlist.curator}
          </span>
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
        <p className={'truncate font-medium ' + (variant === 'hero' ? 'text-[15px]' : 'text-sm')}>
          {playlist.title}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {playlist.curator ?? 'Tidal'}
          {typeof playlist.trackCount === 'number' ? ` · ${playlist.trackCount} треков` : ''}
        </p>
        {variant === 'hero' && playlist.description && (
          <p className="mt-1 line-clamp-2 text-xs text-muted-foreground/80">
            {playlist.description}
          </p>
        )}
      </div>
    </motion.div>
  );
}
