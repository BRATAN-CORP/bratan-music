import { useEffect, useState } from 'react';

/** Returns true on devices whose primary input is touch (phones, most tablets). */
export function useCoarsePointer(): boolean {
  const [coarse, setCoarse] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(pointer: coarse)');
    setCoarse(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setCoarse(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return coarse;
}

/** Returns true ONLY on devices that have *no* hover capability AND a
 *  coarse pointer — i.e. real mobile phones / tablets. A touchscreen
 *  laptop with a trackpad reports `pointer: coarse` for its touch
 *  surface but still has `hover: hover` from the trackpad, so this
 *  hook returns false for it (which is what we want — the in-app
 *  volume slider should still show on touchscreen laptops). */
export function useTouchOnlyDevice(): boolean {
  const [touchOnly, setTouchOnly] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(hover: none) and (pointer: coarse)');
    setTouchOnly(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setTouchOnly(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return touchOnly;
}
