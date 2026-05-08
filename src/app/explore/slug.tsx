import { useParams, Link } from 'react-router-dom';
import { AlertCircle, ChevronLeft } from 'lucide-react';
import { AuthGuard } from '@/components/features/AuthGuard';
import { ExploreModules } from '@/components/features/ExploreModules';
import { ExploreFeedSkeleton } from '@/components/ui/Skeleton';
import { Eyebrow } from '@/components/ui/SectionHeading';
import { useExplorePage } from '@/hooks/useExplore';
import { useT } from '@/i18n';

export function ExploreSlugPage() {
  const t = useT();
  const { slug } = useParams<{ slug: string }>();
  const { data, isLoading, error } = useExplorePage(slug);

  return (
    <AuthGuard>
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-4 sm:p-6 lg:p-10">
        <div className="flex flex-col gap-2">
          <Eyebrow
            as={Link}
            to="/explore"
            className="inline-flex w-fit items-center gap-1 transition-colors hover:text-foreground"
          >
            <ChevronLeft size={12} />
            {t('exploreSlug.eyebrow')}
          </Eyebrow>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            {data?.title ?? slug}
          </h1>
        </div>

        {isLoading && <ExploreFeedSkeleton count={3} />}

        {error && (
          <div className="flex flex-col items-center gap-3 rounded-[var(--radius-md)] border border-border bg-card py-14 text-center">
            <AlertCircle size={24} className="text-[var(--color-danger)]" />
            <div className="text-sm">{t('exploreSlug.failedTitle')}</div>
            <div className="text-xs text-muted-foreground">
              {error instanceof Error ? error.message : t('exploreSlug.unknownError')}
            </div>
          </div>
        )}

        {data && <ExploreModules modules={data.modules} parentSlug={slug} />}
      </div>
    </AuthGuard>
  );
}
