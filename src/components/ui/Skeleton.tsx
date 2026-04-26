interface SkeletonProps {
  className?: string;
}

export function Skeleton({ className = '' }: SkeletonProps) {
  return (
    <div
      className={`animate-pulse rounded-lg ${className}`}
      style={{ backgroundColor: 'var(--color-bg-muted)' }}
    />
  );
}

export function TrackSkeleton() {
  return (
    <div className="flex items-center gap-3 p-2">
      <Skeleton className="w-10 h-10 rounded" />
      <div className="flex-1 flex flex-col gap-1">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-3 w-1/2" />
      </div>
      <Skeleton className="h-3 w-10" />
    </div>
  );
}

export function AlbumSkeleton() {
  return (
    <div className="flex flex-col gap-2 p-3">
      <Skeleton className="w-full aspect-square rounded-lg" />
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="h-3 w-1/2" />
    </div>
  );
}

export function ArtistSkeleton() {
  return (
    <div className="flex flex-col items-center gap-2 p-3">
      <Skeleton className="w-24 h-24 rounded-full" />
      <Skeleton className="h-4 w-16" />
    </div>
  );
}
