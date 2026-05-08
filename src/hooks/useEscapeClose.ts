import { useEffect } from 'react';

/**
 * Run `onClose` when the user presses Esc while `active` is true.
 * `enabled` lets the consumer keep the dialog mounted but suppress
 * the keyboard shortcut (e.g. while an async confirm is in flight).
 */
export function useEscapeClose(active: boolean, onClose: () => void, enabled = true) {
  useEffect(() => {
    if (!active || !enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, enabled, onClose]);
}
