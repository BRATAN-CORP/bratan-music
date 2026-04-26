interface SkeletonProps {
  className?: string;
}

export function Skeleton({ className = '' }: SkeletonProps) {
  return (
    <div
      className={`animate-pulse rounded-[var(--radius-sm)] ${className}`}
      style={{ backgroundColor: 'var(--color-bg-muted)' }}
    />
  );
}

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
