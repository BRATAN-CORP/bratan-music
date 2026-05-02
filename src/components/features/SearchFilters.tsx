import { useT } from '@/i18n';
import type { TranslationKey } from '@/i18n';

type SearchFilter = 'all' | 'tracks' | 'albums' | 'artists';

interface SearchFiltersProps {
  active: SearchFilter;
  onChange: (filter: SearchFilter) => void;
}

const FILTERS: { value: SearchFilter; key: TranslationKey }[] = [
  { value: 'all', key: 'search.filters.all' },
  { value: 'tracks', key: 'search.filters.tracks' },
  { value: 'albums', key: 'search.filters.albums' },
  { value: 'artists', key: 'search.filters.artists' },
];

export function SearchFilters({ active, onChange }: SearchFiltersProps) {
  const t = useT();
  return (
    <div className="flex w-fit max-w-full flex-wrap gap-x-6 gap-y-1 border-b border-border">
      {FILTERS.map(({ value, key }) => (
        <button
          key={value}
          onClick={() => onChange(value)}
          className={`-mb-px border-b-2 px-1 pb-3 text-sm font-medium transition-colors ${
            active === value
              ? 'border-foreground text-foreground'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          {t(key)}
        </button>
      ))}
    </div>
  );
}
