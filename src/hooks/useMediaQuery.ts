import { useEffect, useState } from 'react';

/**
 * Reactive `window.matchMedia` wrapper. SSR-safe (returns `false` during
 * pre-hydrate) and re-fires whenever the query starts/stops matching.
 *
 * Example:
 *   const isMd = useMediaQuery('(min-width: 768px)');
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia(query);
    setMatches(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}
