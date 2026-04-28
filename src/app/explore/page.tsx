import { AlertCircle, Loader2 } from 'lucide-react';
import { AuthGuard } from '@/components/features/AuthGuard';
import { ExploreModules } from '@/components/features/ExploreModules';
import { useExplore } from '@/hooks/useExplore';

export function ExplorePage() {
  const { data, isLoading, error } = useExplore();

  return (
    <AuthGuard>
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-4 sm:p-6 lg:p-10">
        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium uppercase tracking-[0.25em] text-muted-foreground">
            Подборки
          </span>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            {data?.title ?? 'Обзор'}
          </h1>
        </div>

        {isLoading && (
          <div className="flex items-center justify-center gap-2 py-20 text-xs text-muted-foreground">
            <Loader2 size={14} className="animate-spin" />
            Загружаем обзор Tidal…
          </div>
        )}

        {error && (
          <div className="flex flex-col items-center gap-3 rounded-[var(--radius-md)] border border-border bg-card py-14 text-center">
            <AlertCircle size={24} className="text-[var(--color-danger)]" />
            <div className="text-sm">Не удалось загрузить обзор</div>
            <div className="text-xs text-muted-foreground">
              {error instanceof Error ? error.message : 'Неизвестная ошибка'}
            </div>
          </div>
        )}

        {data && <ExploreModules modules={data.modules} />}
      </div>
    </AuthGuard>
  );
}
