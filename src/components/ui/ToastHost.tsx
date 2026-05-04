import { useEffect, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import type { LucideIcon } from 'lucide-react';
import {
  AlertOctagon, AlertTriangle, CheckCircle2, Info, X,
} from 'lucide-react';
import { useToastStore, type Toast, type ToastTone } from '@/store/toast';
import { useT } from '@/i18n';

/**
 * Global toast surface mounted once at the layout root. Renders the
 * stack from `useToastStore` in the **top-left** corner per UX spec
 * (errors don't compete with the bottom mini-player or the sidebar
 * search affordance). Stacks newest-on-bottom so the entry animation
 * pushes older toasts upward instead of jumping. Ignored by
 * pointer-events on the wrapper so clicks pass through to the page;
 * each individual toast re-enables them on its own surface.
 */
export function ToastHost() {
  const toasts = useToastStore((s) => s.toasts);
  return (
    <div
      className="pointer-events-none fixed left-3 top-3 z-[80] flex w-[min(360px,calc(100vw-1.5rem))] flex-col gap-2 sm:left-4 sm:top-4"
      role="region"
      aria-label="Notifications"
      aria-live="polite"
    >
      <AnimatePresence initial={false}>
        {toasts.map((t) => (
          <ToastCard key={t.id} toast={t} />
        ))}
      </AnimatePresence>
    </div>
  );
}

const TONE_ICON: Record<ToastTone, LucideIcon> = {
  error: AlertOctagon,
  warn: AlertTriangle,
  info: Info,
  success: CheckCircle2,
};

const TONE_CLS: Record<ToastTone, { surface: string; icon: string; bar: string }> = {
  error: {
    surface: 'border-[var(--color-danger)]/40 bg-[var(--color-danger-muted)] text-[var(--color-danger)]',
    icon: 'text-[var(--color-danger)]',
    bar: 'bg-[var(--color-danger)]',
  },
  warn: {
    surface: 'border-amber-500/40 bg-amber-500/10 text-amber-500',
    icon: 'text-amber-500',
    bar: 'bg-amber-500',
  },
  info: {
    surface: 'border-[var(--color-accent)]/40 bg-[var(--color-accent-soft)] text-[var(--color-accent)]',
    icon: 'text-[var(--color-accent)]',
    bar: 'bg-[var(--color-accent)]',
  },
  success: {
    surface: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-500',
    icon: 'text-emerald-500',
    bar: 'bg-emerald-500',
  },
};

function ToastCard({ toast }: { toast: Toast }) {
  const t = useT();
  const reduce = useReducedMotion();
  const dismiss = useToastStore((s) => s.dismiss);
  const Icon = TONE_ICON[toast.tone];
  const cls = TONE_CLS[toast.tone];

  // Drives the auto-dismiss progress bar at the bottom edge. The actual
  // dismiss is owned by the store's setTimeout so pause-on-hover would
  // need to be coordinated with it — for now we keep things simple and
  // the bar is purely cosmetic. With duration=0 we hide the bar.
  const [progress, setProgress] = useState(1);
  useEffect(() => {
    if (toast.duration <= 0) return;
    const start = toast.createdAt;
    const end = start + toast.duration;
    let raf = 0;
    const tick = () => {
      const now = Date.now();
      const left = Math.max(0, end - now) / toast.duration;
      setProgress(left);
      if (left > 0) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [toast.duration, toast.createdAt]);

  return (
    <motion.div
      role="status"
      layout
      initial={reduce ? { opacity: 0 } : { opacity: 0, x: -16, scale: 0.97 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={reduce ? { opacity: 0 } : { opacity: 0, x: -16, scale: 0.97, transition: { duration: 0.18 } }}
      transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
      className={`pointer-events-auto liquid-glass relative overflow-hidden rounded-[var(--radius-md)] border ${cls.surface} shadow-[0_8px_24px_-12px_rgba(0,0,0,0.45)]`}
    >
      <div className="flex gap-3 px-3 py-2.5">
        <Icon size={16} className={`mt-0.5 shrink-0 ${cls.icon}`} />
        <div className="min-w-0 flex-1 text-sm">
          {toast.title && <div className="mb-0.5 font-medium text-foreground">{toast.title}</div>}
          <div className="break-words text-foreground/90">{toast.message}</div>
        </div>
        <button
          type="button"
          onClick={() => dismiss(toast.id)}
          className="-mr-1 -mt-1 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          aria-label={t('common.close')}
        >
          <X size={12} />
        </button>
      </div>
      {toast.duration > 0 && (
        <div
          className={`absolute bottom-0 left-0 h-[2px] ${cls.bar}`}
          style={{ width: `${progress * 100}%`, transition: 'width 0.05s linear' }}
          aria-hidden
        />
      )}
    </motion.div>
  );
}
