import { create } from 'zustand';

export type ToastTone = 'error' | 'warn' | 'info' | 'success';

export interface Toast {
  /** Stable id used as React key and dismiss handle. Auto-generated. */
  id: string;
  tone: ToastTone;
  message: string;
  /** Optional title rendered in bold on the first line. Body still wraps. */
  title?: string;
  /** Auto-dismiss delay in ms. `0` keeps the toast pinned until the user
   *  clicks the close button. Defaults to 4000 (errors → 5000). */
  duration: number;
  createdAt: number;
}

export interface ToastInput {
  tone?: ToastTone;
  message: string;
  title?: string;
  /** Override the default tone-based duration. `0` = sticky. */
  duration?: number;
}

interface ToastState {
  toasts: Toast[];
  /** Push a new toast and return its id so callers can dismiss it
   *  early (e.g. on undo). */
  push: (t: ToastInput) => string;
  dismiss: (id: string) => void;
  clear: () => void;
}

/**
 * Default duration per tone. Errors stick around a touch longer because
 * the user is more likely to actually need to read them; success
 * confirmations should feel snappy and disappear without ceremony.
 */
const DEFAULT_DURATIONS: Record<ToastTone, number> = {
  error: 5000,
  warn: 4500,
  info: 4000,
  success: 3000,
};

/**
 * Cap the visible stack so that a noisy error loop (e.g. flaky network
 * triggering one toast per audio retry) doesn't blanket the screen.
 * Older toasts are evicted from the top of the stack.
 */
const MAX_STACK = 4;

let counter = 0;
function nextId(): string {
  counter += 1;
  return `t-${Date.now().toString(36)}-${counter.toString(36)}`;
}

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],
  push: (input) => {
    const id = nextId();
    const tone: ToastTone = input.tone ?? 'info';
    const toast: Toast = {
      id,
      tone,
      message: input.message,
      title: input.title,
      duration: input.duration ?? DEFAULT_DURATIONS[tone],
      createdAt: Date.now(),
    };
    set((s) => {
      // Drop the oldest if we're over the cap. Keeping the most
      // recent matches what users actually want — the latest
      // failure is almost always the one worth reading.
      const next = [...s.toasts, toast];
      while (next.length > MAX_STACK) next.shift();
      return { toasts: next };
    });
    if (toast.duration > 0) {
      // Self-dismiss. The timer is set in the store on purpose so
      // pure non-React callers (audio engine, websocket handlers)
      // get the full lifecycle without needing a hook.
      window.setTimeout(() => {
        // Re-check existence — the user might have dismissed it
        // manually before the timer fires.
        if (get().toasts.some((t) => t.id === id)) {
          set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
        }
      }, toast.duration);
    }
    return id;
  },
  dismiss: (id) =>
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  clear: () => set({ toasts: [] }),
}));

/**
 * Imperative helpers callable from anywhere — non-React code (audio
 * engine event listeners, websocket handlers, fetch wrappers, …) can
 * reach the store without going through a hook.
 *
 *   import { toast } from '@/store/toast';
 *   toast.error('Не удалось загрузить трек');
 */
export const toast = {
  push: (input: ToastInput) => useToastStore.getState().push(input),
  error: (message: string, opts?: Omit<ToastInput, 'message' | 'tone'>) =>
    useToastStore.getState().push({ tone: 'error', message, ...opts }),
  warn: (message: string, opts?: Omit<ToastInput, 'message' | 'tone'>) =>
    useToastStore.getState().push({ tone: 'warn', message, ...opts }),
  info: (message: string, opts?: Omit<ToastInput, 'message' | 'tone'>) =>
    useToastStore.getState().push({ tone: 'info', message, ...opts }),
  success: (message: string, opts?: Omit<ToastInput, 'message' | 'tone'>) =>
    useToastStore.getState().push({ tone: 'success', message, ...opts }),
  dismiss: (id: string) => useToastStore.getState().dismiss(id),
  clear: () => useToastStore.getState().clear(),
};
