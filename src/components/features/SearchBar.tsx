import { useState, useCallback, useRef, useEffect } from 'react';
import { Search, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';

interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

export function SearchBar({ value, onChange, placeholder = 'Поиск треков, альбомов, артистов...' }: SearchBarProps) {
  const [local, setLocal] = useState(value);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();
  const inputRef = useRef<HTMLInputElement>(null);

  const debouncedOnChange = useCallback(
    (val: string) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => onChange(val), 350);
    },
    [onChange]
  );

  const handleChange = (val: string) => {
    setLocal(val);
    debouncedOnChange(val);
  };

  const handleClear = () => {
    setLocal('');
    onChange('');
    inputRef.current?.focus();
  };

  useEffect(() => {
    setLocal(value);
  }, [value]);

  return (
    <div className="group relative flex items-center gap-3 overflow-hidden rounded-[var(--radius-lg)] border border-border bg-card px-4 transition-all duration-300 focus-within:border-[var(--color-accent)] focus-within:shadow-[0_0_0_4px_var(--color-accent-soft)]">
      <Search size={16} className="shrink-0 text-muted-foreground transition-colors group-focus-within:text-[var(--color-accent)]" />
      <input
        ref={inputRef}
        type="text"
        value={local}
        onChange={(e) => handleChange(e.target.value)}
        placeholder={placeholder}
        className="h-12 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground"
      />
      {local && (
        <Button type="button" variant="ghost" size="icon" onClick={handleClear} className="h-7 w-7" aria-label="Очистить">
          <X size={14} />
        </Button>
      )}
    </div>
  );
}
