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
    <div className="glass-panel flex w-fit max-w-full gap-1 overflow-x-auto rounded-full p-1">
      {filters.map(({ value, label }) => (
        <button
          key={value}
          onClick={() => onChange(value)}
          className={`rounded-full px-4 py-2 text-sm font-semibold transition-all duration-200 ${
            active === value
              ? 'bg-primary text-primary-foreground shadow-[var(--shadow-glow)]'
              : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
