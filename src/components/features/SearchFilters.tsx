type SearchFilter = 'all' | 'tracks' | 'albums' | 'artists';

interface SearchFiltersProps {
  active: SearchFilter;
  onChange: (filter: SearchFilter) => void;
}

const filters: { value: SearchFilter; label: string }[] = [
  { value: 'all', label: 'Все' },
  { value: 'tracks', label: 'Треки' },
  { value: 'albums', label: 'Альбомы' },
  { value: 'artists', label: 'Артисты' },
];

export function SearchFilters({ active, onChange }: SearchFiltersProps) {
  return (
    <div className="flex w-fit max-w-full gap-6 overflow-x-auto border-b border-border">
      {filters.map(({ value, label }) => (
        <button
          key={value}
          onClick={() => onChange(value)}
          className={`-mb-px border-b-2 px-1 pb-3 text-sm font-medium transition-colors ${
            active === value
              ? 'border-foreground text-foreground'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
