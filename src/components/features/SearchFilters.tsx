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
    <div className="flex gap-2">
      {filters.map(({ value, label }) => (
        <button
          key={value}
          onClick={() => onChange(value)}
          className="px-4 py-1.5 rounded-full text-sm font-medium transition-colors"
          style={{
            backgroundColor: active === value ? 'var(--color-accent)' : 'var(--color-bg-muted)',
            color: active === value ? 'var(--color-text-on-accent)' : 'var(--color-text-muted)',
          }}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
