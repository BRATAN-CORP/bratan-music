import { useState, useCallback, useRef, useEffect } from 'react';
import { Search, X } from 'lucide-react';

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
    <div
      className="flex items-center gap-2 px-4 py-3 rounded-xl"
      style={{ backgroundColor: 'var(--color-bg-subtle)', border: '1px solid var(--color-border)' }}
    >
      <Search size={18} style={{ color: 'var(--color-text-subtle)', flexShrink: 0 }} />
      <input
        ref={inputRef}
        type="text"
        value={local}
        onChange={(e) => handleChange(e.target.value)}
        placeholder={placeholder}
        className="flex-1 bg-transparent outline-none text-sm"
        style={{ color: 'var(--color-text)' }}
      />
      {local && (
        <button onClick={handleClear} className="hover:opacity-70">
          <X size={16} style={{ color: 'var(--color-text-subtle)' }} />
        </button>
      )}
    </div>
  );
}
