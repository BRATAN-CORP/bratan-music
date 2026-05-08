import { LayoutGroup, motion } from 'motion/react';
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
    // Shared-layout active underline — same idiom as `<LanguageSwitcher>`
    // and `/library`'s tabs, so the four discovery surfaces speak with one
    // animation vocabulary. `initial={false}` keeps the underline put on
    // first paint and lets it slide between filters thereafter.
    <LayoutGroup id="search-filters">
      <div className="flex w-fit max-w-full flex-wrap gap-x-6 gap-y-1 border-b border-border">
        {FILTERS.map(({ value, key }) => {
          const isActive = active === value;
          return (
            <button
              key={value}
              onClick={() => onChange(value)}
              className={`relative -mb-px px-1 pb-3 text-sm font-medium transition-colors ${
                isActive ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
              }`}
              aria-pressed={isActive}
            >
              {t(key)}
              {isActive && (
                <motion.span
                  layoutId="search-filter-underline"
                  initial={false}
                  className="absolute inset-x-0 -bottom-0.5 h-0.5 rounded-full bg-foreground"
                  transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                  aria-hidden
                />
              )}
            </button>
          );
        })}
      </div>
    </LayoutGroup>
  );
}
