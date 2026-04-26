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
    <div className="group flex items-center gap-3 rounded-[var(--radius-md)] border border-border bg-background px-4 transition-colors focus-within:border-foreground">
      <Search size={16} className="shrink-0 text-muted-foreground" />
      <input
        ref={inputRef}
        type="text"
        value={local}
        onChange={(e) => handleChange(e.target.value)}
        placeholder={placeholder}
        className="h-10 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
      />
      {local && (
        <Button type="button" variant="ghost" size="icon" onClick={handleClear} className="h-7 w-7" aria-label="Очистить">
          <X size={14} />
        </Button>
      )}
    </div>
  );
}
