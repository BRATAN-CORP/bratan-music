import { Link } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CalendarRange, ChevronLeft, ChevronRight, ListMusic, Loader2, Play, Sparkles } from 'lucide-react';
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
import { tidalImageUrl } from '@/lib/tidal-image';
import { useT } from '@/i18n';

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
  /**
   * The slug of the containing explore page (e.g. "genre_hip_hop"
   * or "explore" for the landing). Required to build "Смотреть
   * все" links that route to `/explore/:parentSlug/list/:index`.
   * When omitted, the see-all affordance is hidden.
   */
  parentSlug?: string;
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
  parentSlug,
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
        // Build a "see all" link only when upstream exposed a
        // `moreApiPath` on this module AND we know the parent slug
        // (so we can route to /explore/:parentSlug/list/:index).
        // PageLinks rows are excluded — they're navigation, not
        // content, and rendering a see-all affordance next to them
        // is meaningless.
        const seeAllHref =
          m.type !== 'pageLinks' && parentSlug && m.moreApiPath
            ? `/explore/${parentSlug}/list/${i}`
            : undefined;
        return (
          <ModuleRow
            key={`${m.type}-${i}-${m.title}`}
            module={m}
            hero={hero}
            seeAllHref={seeAllHref}
          />
        );
      })}
    </div>
  );
}

function ModuleRow({
  module: m,
  hero,
  seeAllHref,
}: {
  module: ExploreModule;
  hero: boolean;
  seeAllHref: string | undefined;
}) {
  switch (m.type) {
    case 'pageLinks':
      // Tidal returns a mix of icon-only links (e.g. "Mood &
      // Activity" bullets) and image-backed links (genres). When
      // every item carries an imageId we can render a rich tile
      // grid; otherwise we fall back to the compact pill cloud so
      // an icon-only row doesn't get awkwardly large empty cards.
      {
        // Decade rows (`m_1980s`, `m_1990s`, …) render as a compact
        // pill cloud — see `PageLinksDecadeGrid`. The previous big
        // image grid was visually disproportionate to the row's
        // payload (a 4-character label).
        const isDecadeRow =
          m.items.length > 0 &&
          m.items.every(
            (it) =>
              /\b(19|20)\d0s?\b/i.test(it.title) || it.slug.toLowerCase().includes('decade'),
          );
        if (isDecadeRow) {
          return <PageLinksDecadeGrid title={m.title} items={m.items} />;
        }
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
      return <TrackListRow title={m.title} items={m.items} seeAllHref={seeAllHref} />;
    case 'albums':
      return <AlbumScroller title={m.title} items={m.items} seeAllHref={seeAllHref} />;
    case 'artists':
      return <ArtistScroller title={m.title} items={m.items} seeAllHref={seeAllHref} />;
    case 'playlists':
      return (
        <PlaylistScroller
          title={m.title}
          items={m.items}
          hero={hero}
          seeAllHref={seeAllHref}
        />
      );
  }
}

function SectionHeader({
  title,
  icon,
  seeAllHref,
}: {
  title: string;
  icon?: React.ReactNode;
  seeAllHref?: string;
}) {
  const t = useT();
  // Some hero rows deliberately suppress the title to reduce visual
  // noise, but still want the see-all affordance when upstream
  // offers pagination. If both are empty, render nothing.
  if (!title && !seeAllHref) return null;
  return (
    <div className="flex items-end justify-between gap-3">
      {title ? (
        <h2 className="flex items-center gap-2 text-base font-semibold tracking-tight">
          {icon}
          {title}
        </h2>
      ) : (
        <span />
      )}
      {seeAllHref && (
        <Link
          to={seeAllHref}
          className="shrink-0 text-xs font-medium uppercase tracking-[0.15em] text-muted-foreground transition-colors hover:text-foreground"
        >
          {t('explore.seeAll')}
        </Link>
      )}
    </div>
  );
}

/**
 * Hero treatment for the top-level "Genres" row: responsive grid of
 * tall image tiles with a gradient + title overlay. No scroll —
 * grid wraps so the whole taxonomy is visible at a glance.
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
 * Standard image-backed row for non-hero pageLinks (moods, decades
 * inside sub-pages). Horizontal snap-scroller.
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

/**
 * Decade ladder as a compact pill cloud — matches the icon-only
 * "Mood & Activity" row's visual weight, since the payload is just
 * a 4-character label.
 */
function PageLinksDecadeGrid({ title, items }: { title: string; items: ExplorePageLink[] }) {
  return (
    <section className="flex flex-col gap-3">
      <SectionHeader
        title={title}
        icon={<CalendarRange size={14} className="text-[var(--color-accent)]" />}
      />
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
              state={{ title: it.title }}
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

function GenreTile({
  item,
  index,
  variant,
}: {
  item: ExplorePageLink;
  index: number;
  variant: 'hero' | 'row';
}) {
  const t = useT();
  // Hero tiles get 640 for retina; row tiles stay at 480 to keep
  // payloads light.
  const img = tidalImageUrl(item.imageId, variant === 'hero' ? 640 : 480);
  // Some pages (decades, a few moods) ship without a cover. Fallback
  // is the landing "feature card" shape — solid surface + icon mark
  // — so a missing image doesn't read as a layout bug.
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
        state={{ title: item.title }}
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
                {variant === 'hero' ? t('explore.tile.genre') : t('explore.tile.collection')}
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
                {isDecade ? t('explore.tile.decade') : t('explore.tile.collection')}
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
              state={{ title: it.title }}
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

function TrackListRow({
  title,
  items,
  seeAllHref,
}: {
  title: string;
  items: Track[];
  seeAllHref?: string;
}) {
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
      artists: track.artists,
      coverUrl: track.coverUrl,
      coverVideoUrl: track.coverVideoUrl,
      duration: track.duration,
    });
  };
  return (
    <section className="flex flex-col gap-3">
      <SectionHeader title={title} seeAllHref={seeAllHref} />
      <div className="rounded-[var(--radius-md)] border border-border bg-background">
        {items.slice(0, 8).map((t, i) => (
          <TrackItem key={t.id} track={t} index={i} onPlay={handlePlay} />
        ))}
      </div>
    </section>
  );
}

/**
 * Builds the CSS mask for the scroller edges: 12-px transparency
 * stripe on the scrollable side, hard `black 0` on the terminus.
 */
function buildEdgeMask(canPrev: boolean, canNext: boolean): string {
  const left = canPrev ? 'transparent 0, black 12px' : 'black 0';
  const right = canNext ? 'black calc(100% - 12px), transparent 100%' : 'black 100%';
  return `linear-gradient(to right, ${left}, ${right})`;
}

function SnapScroller({
  title,
  seeAllHref,
  children,
}: {
  title: string;
  seeAllHref?: string;
  children: React.ReactNode;
}) {
  const t = useT();
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [canPrev, setCanPrev] = useState(false);
  const [canNext, setCanNext] = useState(false);
  // Desktop click-and-drag state. `moved` is a ref (not React state)
  // so the click handler that fires synchronously after pointerup
  // can read it without batching races. `pendingScroll` coalesces
  // multiple pointermoves into one rAF-batched scrollLeft write per
  // frame — synchronous writes per move trigger layout + scroll
  // events and visibly jank long drags. `samples` feeds the
  // post-release inertia animation.
  const dragStateRef = useRef<{
    pointerId: number;
    startX: number;
    startScroll: number;
    moved: boolean;
    pendingScroll: number | null;
    rafId: number | null;
    samples: { t: number; x: number }[];
  } | null>(null);
  // rAF id for the pointer-up momentum animation. Kept on the
  // component (not on dragStateRef) so a fresh pointerdown can
  // cancel an in-flight glide cleanly.
  const inertiaRafRef = useRef<number | null>(null);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const update = () => {
      // Asymmetric tolerance: 8 px on the right because Chromium's
      // smooth-scroll easing and iOS rubber-band overscroll park
      // `scrollLeft` within ±2-4 px of the true endpoint. 1 px on
      // the left because `scroll-snap-type` + scrollPadding parks
      // the start at 4-7 px on mount in Chromium and a wider gate
      // would leave the left chevron stuck visible at the boundary.
      setCanPrev(el.scrollLeft > 1);
      setCanNext(el.scrollLeft + el.clientWidth + 8 < el.scrollWidth);
    };
    // Force the scroller to its true start before the first measure
    // so we don't latch onto a snap-correction offset from the initial
    // layout. `behavior: 'instant'` keeps this off the user's smooth-
    // scroll budget — no animation, just a synchronous reset.
    el.scrollTo({ left: 0, behavior: 'instant' as ScrollBehavior });
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

  // Mouse drag-to-scroll on desktop only — touch users get native
  // flick momentum and hijacking pointer events would fight it.
  //
  // pointerdown stays side-effect-free w.r.t. the click pipeline:
  // we don't call `preventDefault` and don't `setPointerCapture`.
  // Both break clicks on tile `<Link>` children — preventDefault
  // on pointerdown over an `<a>` cancels the synthetic click in
  // Chromium, and pointer capture redirects the click target to
  // the scroller (LCA of pointerdown/pointerup) so the Link's
  // handler never fires. Native HTML5 link/image drag is killed at
  // the `dragstart` level instead (`onDragStart` below). To keep
  // pointermove firing once the cursor leaves the scroller, the
  // move/up listeners attach to `window` for the duration of the
  // gesture. Once we cross the 6-px drag threshold, preventDefault
  // on the move suppresses text-selection and we toggle
  // `body.userSelect = 'none'`.
  const cancelInertia = () => {
    if (inertiaRafRef.current !== null) {
      cancelAnimationFrame(inertiaRafRef.current);
      inertiaRafRef.current = null;
    }
  };

  // Window-level move/up listeners attached during a gesture. Stored
  // on the component so cleanup on pointerup/pointercancel can detach
  // the SAME function references — can't live in `dragStateRef`
  // since the React closure needs the originals.
  const windowMoveRef = useRef<((ev: PointerEvent) => void) | null>(null);
  const windowUpRef = useRef<((ev: PointerEvent) => void) | null>(null);

  const detachWindowListeners = () => {
    if (windowMoveRef.current) {
      window.removeEventListener('pointermove', windowMoveRef.current);
      windowMoveRef.current = null;
    }
    if (windowUpRef.current) {
      window.removeEventListener('pointerup', windowUpRef.current);
      window.removeEventListener('pointercancel', windowUpRef.current);
      windowUpRef.current = null;
    }
  };

  const handlePointerMove = (e: PointerEvent) => {
    const drag = dragStateRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    const el = scrollerRef.current;
    if (!el) return;
    const dx = e.clientX - drag.startX;
    // Drag activation threshold: 6 px. Below that the gesture is a
    // click — don't touch scrollLeft, otherwise trackpad jitter
    // (3-5 px between mousedown/up on a normal tap) would shift the
    // row under the cursor AND trip the click-suppressor.
    if (!drag.moved) {
      if (Math.abs(dx) <= 6) return;
      drag.moved = true;
      // Drag committed: disable snap (browser would fight every
      // scrollLeft write), kill text-selection.
      el.style.scrollSnapType = 'none';
      document.body.style.userSelect = 'none';
    }
    if (drag.moved) {
      e.preventDefault();
    }
    // Rolling window for velocity: we want the LAST ~80 ms only.
    // Averaging the whole drag would cancel direction reversals.
    const now = performance.now();
    drag.samples.push({ t: now, x: e.clientX });
    while (drag.samples.length > 6) drag.samples.shift();
    // Coalesce pointermoves into one scrollLeft write per frame —
    // each sync write triggers layout + a `scroll` event that
    // re-renders React, which is what janks long drags.
    drag.pendingScroll = drag.startScroll - dx;
    if (drag.rafId === null) {
      drag.rafId = requestAnimationFrame(() => {
        const d = dragStateRef.current;
        const elNow = scrollerRef.current;
        if (!d || !elNow) return;
        d.rafId = null;
        if (d.pendingScroll !== null) {
          elNow.scrollLeft = d.pendingScroll;
          d.pendingScroll = null;
        }
      });
    }
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== 'mouse') return;
    if (e.button !== 0) return;
    const el = scrollerRef.current;
    if (!el) return;
    // Cancel in-flight glide so the row grabs instantly under the
    // new pointer.
    cancelInertia();
    dragStateRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startScroll: el.scrollLeft,
      moved: false,
      pendingScroll: null,
      rafId: null,
      samples: [{ t: performance.now(), x: e.clientX }],
    };
    // Window-level listeners keep the gesture alive when the cursor
    // leaves the scroller, without setPointerCapture (which would
    // re-route the click target).
    detachWindowListeners();
    const onMove = (ev: PointerEvent) => handlePointerMove(ev);
    const onUp = (ev: PointerEvent) => endDragImpl(ev);
    windowMoveRef.current = onMove;
    windowUpRef.current = onUp;
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };
  const endDragImpl = (e: PointerEvent) => {
    const drag = dragStateRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    detachWindowListeners();
    const el = scrollerRef.current;
    // Flush any pending rAF write before computing release velocity
    // so inertia starts from the actual final cursor position.
    if (drag.rafId !== null) {
      cancelAnimationFrame(drag.rafId);
      drag.rafId = null;
    }
    if (el && drag.pendingScroll !== null) {
      el.scrollLeft = drag.pendingScroll;
      drag.pendingScroll = null;
    }
    // Clear after a microtask so the post-pointerup click handler
    // can still read `moved` to suppress link navigation.
    const wasMoved = drag.moved;
    const samples = drag.samples;
    setTimeout(() => {
      if (dragStateRef.current === drag) dragStateRef.current = null;
    }, 0);
    // Restore page-level userSelect regardless of whether we glided.
    document.body.style.userSelect = '';
    if (wasMoved) {
      // Suppress the synthetic click after drag-release so dropping
      // on a tile doesn't activate it.
      const suppress = (ev: MouseEvent) => {
        ev.preventDefault();
        ev.stopPropagation();
        document.removeEventListener('click', suppress, true);
      };
      document.addEventListener('click', suppress, true);
      setTimeout(() => document.removeEventListener('click', suppress, true), 200);
      // Velocity from last ~80 ms of samples; floor dt at 10 ms so
      // sub-ms windows don't spike on trackpad jitter.
      const last = samples[samples.length - 1];
      const first = (last && samples.find((s) => last.t - s.t <= 80)) ?? samples[0];
      if (!last || !first) {
        if (el) el.style.scrollSnapType = '';
        return;
      }
      const dt = Math.max(10, last.t - first.t);
      const velocity = (last.x - first.x) / dt;
      // <0.05 px/ms = deliberate stop, skip the glide.
      if (el && Math.abs(velocity) > 0.05) {
        // Exponential decay: friction^(frameMs/16) per frame gives
        // a ~250-300 ms glide that feels close to native trackpad
        // inertia. Direction inverted: cursor RIGHT → scrollLeft
        // DECREASES.
        let v = -velocity;
        let lastT = performance.now();
        const friction = 0.94;
        const step = (now: number) => {
          const elNow = scrollerRef.current;
          if (!elNow) {
            inertiaRafRef.current = null;
            return;
          }
          const frameDt = now - lastT;
          lastT = now;
          elNow.scrollLeft += v * frameDt;
          // Stop early on edge hit — otherwise the animation keeps
          // pushing against a clamped scrollLeft for the full decay
          // window and just looks frozen.
          const hitEdge = elNow.scrollLeft <= 0
            || elNow.scrollLeft >= elNow.scrollWidth - elNow.clientWidth - 1;
          v *= Math.pow(friction, frameDt / 16);
          if (Math.abs(v) < 0.02 || hitEdge) {
            inertiaRafRef.current = null;
            // Restore snap so the final position aligns to a card.
            elNow.style.scrollSnapType = '';
            return;
          }
          inertiaRafRef.current = requestAnimationFrame(step);
        };
        inertiaRafRef.current = requestAnimationFrame(step);
        return;
      }
    }
    // No glide → restore snap synchronously so the row latches to
    // a card without a perceptible wait.
    if (el) el.style.scrollSnapType = '';
  };

  return (
    <section className="relative flex flex-col gap-3">
      <SectionHeader title={title} seeAllHref={seeAllHref} />
      <div className="relative">
        <div
          ref={scrollerRef}
          // `scroll-pl-*` / `scroll-pr-*` must mirror the responsive
          // `px-*` values exactly: `snap-start` targets are
          // `child.offsetLeft - scroll-padding-left`, so a mismatch
          // shifts the start snap point off `scrollLeft: 0` and
          // resurrects the left chevron at first paint.
          className="-mx-4 overflow-x-auto overflow-y-hidden px-4 pb-2 scroll-pl-4 scroll-pr-4 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden sm:-mx-6 sm:px-6 sm:scroll-pl-6 sm:scroll-pr-6 lg:-mx-10 lg:px-10 lg:scroll-pl-10 lg:scroll-pr-10 cursor-grab active:cursor-grabbing"
          style={{
            // `proximity` not `mandatory`: mandatory pulls the row
            // back to the first snap target on release even when the
            // user dragged to the true boundary, which flickers the
            // left chevron back into view at the start.
            scrollSnapType: 'x proximity',
            // Soft edge mask, applied only on the side that can
            // actually scroll — fading the active edge looks like
            // the row is disabled.
            WebkitMaskImage: buildEdgeMask(canPrev, canNext),
            maskImage: buildEdgeMask(canPrev, canNext),
          }}
          onPointerDown={onPointerDown}
          // Suppress native HTML5 link/image drag without touching
          // pointerdown — keeps tile `<Link>` clicks intact.
          onDragStart={(e) => e.preventDefault()}
        >
          <div className="flex gap-4">{children}</div>
        </div>

        {/* Desktop chevrons (hidden < md). `canPrev` / `canNext`
            recompute on scroll + container resize + per-child resize
            so a partial measure during image decode doesn't leave a
            phantom chevron at the edges. */}
        {canPrev && (
          <button
            type="button"
            aria-label={t('explore.row.prev')}
            onClick={() => step(-1)}
            className="absolute left-0 top-1/2 hidden h-10 w-10 -translate-y-1/2 -translate-x-1 items-center justify-center rounded-full border border-border bg-background/80 text-foreground shadow-lg backdrop-blur-md transition-colors hover:bg-background md:flex"
          >
            <ChevronLeft size={18} />
          </button>
        )}
        {canNext && (
          <button
            type="button"
            aria-label={t('explore.row.next')}
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

function AlbumScroller({
  title,
  items,
  seeAllHref,
}: {
  title: string;
  items: import('@/types').Album[];
  seeAllHref?: string;
}) {
  return (
    <SnapScroller title={title} seeAllHref={seeAllHref}>
      {items.map((a) => (
        <div key={a.id} className="w-[160px] shrink-0 snap-start sm:w-[180px]">
          <AlbumCard album={a} />
        </div>
      ))}
    </SnapScroller>
  );
}

function ArtistScroller({
  title,
  items,
  seeAllHref,
}: {
  title: string;
  items: import('@/types').Artist[];
  seeAllHref?: string;
}) {
  return (
    <SnapScroller title={title} seeAllHref={seeAllHref}>
      {items.map((a) => (
        <div key={a.id} className="w-[140px] shrink-0 snap-start sm:w-[160px]">
          <ArtistCard artist={a} />
        </div>
      ))}
    </SnapScroller>
  );
}

function PlaylistScroller({
  title,
  items,
  hero,
  seeAllHref,
}: {
  title: string;
  items: ExplorePlaylist[];
  hero: boolean;
  seeAllHref?: string;
}) {
  // Hero playlist row gets larger tiles and a richer card layout
  // (description + curator badge). Subsequent playlist rows use the
  // standard compact card so we don't drown the page in 240-px
  // tiles when Tidal returns multiple playlist sections.
  const cardWidth = hero ? 'w-[220px] sm:w-[260px]' : 'w-[180px] sm:w-[200px]';
  return (
    <SnapScroller title={title} seeAllHref={seeAllHref}>
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
  const t = useT();
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
      // On-demand fetch — eager per-card would fire 15 round-trips
      // just to render the row.
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
        artists: first.artists,
        coverUrl: first.coverUrl,
        coverVideoUrl: first.coverVideoUrl,
        duration: first.duration,
      });
    } finally {
      setLoading(false);
    }
  };

  // Hover model matches AlbumCard: only the cover scales, the card
  // stays anchored — keeps playlist rows visually consistent with
  // album rows.
  return (
    <Link
      to={`/explore/playlist/${playlist.id}`}
      className="group flex flex-col gap-2.5 focus:outline-none"
      aria-label={t('explore.playlist.openAria', { title: playlist.title })}
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
          aria-label={t('explore.playlist.playAria', { title: playlist.title })}
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
          {typeof playlist.trackCount === 'number'
            ? ` · ${t('explore.playlist.tracksCount', { count: playlist.trackCount })}`
            : ''}
        </p>
        {variant === 'hero' && playlist.description && (
          <p className="mt-1 line-clamp-2 text-xs text-muted-foreground/80">
            {playlist.description}
          </p>
        )}
      </div>
    </Link>
  );
}
