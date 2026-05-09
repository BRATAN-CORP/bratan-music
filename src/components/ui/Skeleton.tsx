interface SkeletonProps {
  className?: string;
}

/**
 * Loading-state placeholder ("bone card"). Shape is driven by the
 * caller via `className` (Tailwind sizing + radius); this component
 * just paints the muted base, runs the gentle `animate-pulse` breath
 * Tailwind ships with, and overlays the shared `.skeleton-shimmer`
 * sweep defined in globals.scss for a richer feel than a flat block.
 *
 * Used as a primitive for the row / card / module variants exported
 * below — and freely throughout pages whose loading shape doesn't
 * map onto one of those variants.
 */
export function Skeleton({ className = '' }: SkeletonProps) {
  return (
    <div
      className={`skeleton-shimmer animate-pulse rounded-[var(--radius-sm)] ${className}`}
      style={{ backgroundColor: 'var(--color-bg-muted)' }}
    />
  );
}

/* ------------------------------------------------------------------
 * Row & card variants — match the live components they stand in for,
 * so swapping the spinner for a skeleton doesn't shift layout when
 * data lands. Each one is intentionally small and composable; pages
 * compose `Array.from({length: N}).map(...)` and render the variant
 * the appropriate number of times.
 * ------------------------------------------------------------------ */

export function TrackSkeleton() {
  return (
    <div className="flex items-center gap-3 border-b border-border px-3 py-2 last:border-b-0">
      <Skeleton className="h-10 w-10" />
      <div className="flex flex-1 flex-col gap-1">
        <Skeleton className="h-3 w-3/4" />
        <Skeleton className="h-2.5 w-1/2" />
      </div>
      <Skeleton className="h-2.5 w-10" />
    </div>
  );
}

export function AlbumSkeleton() {
  return (
    <div className="flex flex-col gap-2">
      <Skeleton className="aspect-square w-full" />
      <Skeleton className="h-3 w-3/4" />
      <Skeleton className="h-2.5 w-1/2" />
    </div>
  );
}

export function ArtistSkeleton() {
  return (
    <div className="flex flex-col items-center gap-2">
      <Skeleton className="h-24 w-24 rounded-full" />
      <Skeleton className="h-3 w-16" />
    </div>
  );
}

export function PlaylistSkeleton() {
  return (
    <div className="flex flex-col gap-2.5">
      <Skeleton className="aspect-square w-full rounded-[var(--radius-md)]" />
      <Skeleton className="h-3 w-2/3" />
      <Skeleton className="h-2.5 w-1/3" />
    </div>
  );
}

/**
 * Mirrors `<PlaylistCard>` (the horizontal row layout used in the
 * library Playlists tab). Square thumbnail + title + meta row +
 * trailing kebab. Used as the loading state for the library list
 * so the skeleton occupies the same vertical band as the live
 * cards once they land.
 */
export function PlaylistRowSkeleton() {
  return (
    <div className="flex items-center gap-4 rounded-[var(--radius-md)] border border-border bg-card px-4 py-3">
      <Skeleton className="h-12 w-12 rounded-[var(--radius-sm)]" />
      <div className="min-w-0 flex-1 flex flex-col gap-1.5">
        <Skeleton className="h-3 w-1/2" />
        <Skeleton className="h-2.5 w-20" />
      </div>
      <Skeleton className="h-8 w-8 rounded-[var(--radius-sm)]" />
    </div>
  );
}

export function PlaylistRowListSkeleton({ count = 6 }: CountProps) {
  return (
    <div className="flex flex-col gap-2">
      {Array.from({ length: count }).map((_, i) => (
        <PlaylistRowSkeleton key={i} />
      ))}
    </div>
  );
}

/**
 * Mirrors `<UserRow>` in `src/app/admin/page.tsx`. Used as the
 * loading state for the admin user list — same column grid (`1fr +
 * five fixed-width columns` on lg+, single-column on mobile) so the
 * placeholder occupies the same vertical band as the live row.
 */
export function UserRowSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-3 px-4 py-4 lg:grid-cols-[1fr_120px_120px_120px_120px_140px] lg:items-center">
      <div className="flex items-center gap-3">
        <Skeleton className="h-10 w-10 rounded-full" />
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <Skeleton className="h-3 w-32" />
          <Skeleton className="h-2.5 w-24" />
        </div>
      </div>
      <Skeleton className="h-5 w-16 rounded-full" />
      <Skeleton className="h-5 w-20 rounded-full" />
      <Skeleton className="h-2.5 w-24" />
      <Skeleton className="h-2.5 w-20" />
      <div className="flex items-center justify-end gap-1.5">
        <Skeleton className="h-8 w-8 rounded-full" />
        <Skeleton className="h-8 w-8 rounded-full" />
        <Skeleton className="h-8 w-8 rounded-full" />
      </div>
    </div>
  );
}

interface CountProps {
  count?: number;
}

export function TrackListSkeleton({ count = 6 }: CountProps) {
  return (
    <div className="flex flex-col gap-1">
      {Array.from({ length: count }).map((_, i) => (
        <TrackSkeleton key={i} />
      ))}
    </div>
  );
}

export function AlbumGridSkeleton({ count = 10 }: CountProps) {
  return (
    <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
      {Array.from({ length: count }).map((_, i) => (
        <AlbumSkeleton key={i} />
      ))}
    </div>
  );
}

export function ArtistGridSkeleton({ count = 12 }: CountProps) {
  return (
    <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 md:grid-cols-5 xl:grid-cols-6">
      {Array.from({ length: count }).map((_, i) => (
        <ArtistSkeleton key={i} />
      ))}
    </div>
  );
}

export function PlaylistGridSkeleton({ count = 10 }: CountProps) {
  return (
    <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
      {Array.from({ length: count }).map((_, i) => (
        <PlaylistSkeleton key={i} />
      ))}
    </div>
  );
}

/**
 * Horizontal explore row skeleton — used while the /explore feed is
 * loading. Renders a row eyebrow + a horizontal strip of square card
 * placeholders so the layout pre-allocates the same vertical space
 * the live `<ExploreModules>` row will fill in.
 *
 * The strip mirrors the live `<SnapScroller>` bleed pattern
 * (`-mx-4 overflow-x-hidden px-4` etc.) so the row clips at the
 * page padding instead of leaking past the viewport on narrow
 * screens — the live scroller is horizontally scrollable, but the
 * skeleton stays static (no scrollbar / drag gestures while there's
 * nothing to scroll yet) so we use `overflow-x-hidden` here.
 */
export function ExploreModuleSkeleton() {
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <Skeleton className="h-3 w-32" />
      <div className="-mx-4 overflow-x-hidden px-4 sm:-mx-6 sm:px-6 lg:-mx-10 lg:px-10">
        <div className="flex gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex w-32 shrink-0 flex-col gap-2 sm:w-40">
              <Skeleton className="aspect-square w-full rounded-[var(--radius-md)]" />
              <Skeleton className="h-3 w-3/4" />
              <Skeleton className="h-2.5 w-1/2" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function ExploreFeedSkeleton({ count = 3 }: CountProps) {
  return (
    <div className="flex min-w-0 flex-col gap-10">
      {Array.from({ length: count }).map((_, i) => (
        <ExploreModuleSkeleton key={i} />
      ))}
    </div>
  );
}
