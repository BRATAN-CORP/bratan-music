import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import type { LucideIcon } from 'lucide-react';
import {
  AlertOctagon, AlertTriangle, CheckCircle2, Info, X,
} from 'lucide-react';
import { useToastStore, type Toast, type ToastTone } from '@/store/toast';
import { useT } from '@/i18n';

/**
 * Global toast surface mounted once at the layout root. Renders the
 * stack from `useToastStore` **horizontally centred at the top** of
 * the viewport — the user reported the previous left-aligned variant
 * collided with the sidebar's hover affordances and read like a
 * "developer console" rather than a real notification system.
 *
 * - Centre column with a fixed `max-w` so longer messages wrap
 *   instead of running edge-to-edge.
 * - Stacks newest-on-bottom so the entry animation pushes older
 *   toasts down off-axis without jumping.
 * - `pointer-events-none` on the wrapper so clicks pass through to
 *   the page; each toast re-enables them on its own surface.
 */
export function ToastHost() {
  const toasts = useToastStore((s) => s.toasts);
  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-3 z-[80] flex flex-col items-center gap-2 px-3 sm:top-4"
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

/**
 * Per-tone visual recipe.
 *
 * The recipe keeps the surface neutral (elevated card colour with a
 * tone-tinted border + soft tone glow), reserves the saturated tone
 * colour for the icon, the left accent rail and the dismiss-progress
 * bar, and pushes the message text up to maximum contrast so it
 * never dissolves into the glass plate underneath.
 */
const TONE_CLS: Record<ToastTone, { surface: string; iconWrap: string; icon: string; bar: string; rail: string }> = {
  error: {
    surface: 'border-[var(--color-danger)]/55 ring-1 ring-[var(--color-danger)]/15',
    iconWrap: 'bg-[var(--color-danger-muted)]',
    icon: 'text-[var(--color-danger)]',
    bar: 'bg-[var(--color-danger)]',
    rail: 'bg-[var(--color-danger)]',
  },
  warn: {
    surface: 'border-amber-500/55 ring-1 ring-amber-500/15',
    iconWrap: 'bg-amber-500/15',
    icon: 'text-amber-500',
    bar: 'bg-amber-500',
    rail: 'bg-amber-500',
  },
  info: {
    // Info used to share the accent colour with the rest of the UI
    // (mini-player accents, like-hearts, etc.) and the toast just
    // dissolved into the surrounding chrome. Switched to a neutral
    // sky-blue tone that reads clearly as "informational" without
    // blending with the brand accent.
    surface: 'border-sky-400/55 ring-1 ring-sky-400/15',
    iconWrap: 'bg-sky-400/15',
    icon: 'text-sky-400',
    bar: 'bg-sky-400',
    rail: 'bg-sky-400',
  },
  success: {
    surface: 'border-emerald-500/55 ring-1 ring-emerald-500/15',
    iconWrap: 'bg-emerald-500/15',
    icon: 'text-emerald-500',
    bar: 'bg-emerald-500',
    rail: 'bg-emerald-500',
  },
};

function ToastCard({ toast }: { toast: Toast }) {
  const t = useT();
  const reduce = useReducedMotion();
  const dismiss = useToastStore((s) => s.dismiss);
  const Icon = TONE_ICON[toast.tone];
  const cls = TONE_CLS[toast.tone];

  // CSS-driven dismiss progress bar. We mount the bar at width:100%
  // for a single tick (mountedBar=false → no transition class), then
  // flip mountedBar=true on the next frame which adds the
  // `transition-[width]` rule and sets width:0%. The browser
  // interpolates between the two over `toast.duration` ms — no
  // requestAnimationFrame setState loop, no React re-renders per
  // frame. Rock-solid even when the page is throttled in a
  // background tab.
  const [mountedBar, setMountedBar] = useState(false);
  const rafRef = useRef<number | null>(null);
  useEffect(() => {
    if (toast.duration <= 0) return;
    rafRef.current = requestAnimationFrame(() => setMountedBar(true));
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [toast.duration]);

  return (
    <motion.div
      role="status"
      layout
      initial={reduce ? { opacity: 0 } : { opacity: 0, y: -12, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={reduce ? { opacity: 0 } : { opacity: 0, y: -12, scale: 0.97, transition: { duration: 0.18 } }}
      transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
      className={`pointer-events-auto liquid-glass relative w-full max-w-[440px] overflow-hidden rounded-[var(--radius-lg)] border bg-[var(--color-surface-elevated)] shadow-[0_24px_56px_-24px_rgba(0,0,0,0.55)] ${cls.surface}`}
    >
      {/* Tone accent rail — anchors the toast's tone on the left edge so
          even at a glance the user knows error/warn/info/success without
          having to parse the icon. Sits above the surface fill so the
          glass blur doesn't wash it out. */}
      <span
        className={`pointer-events-none absolute inset-y-0 left-0 w-[3px] ${cls.rail}`}
        aria-hidden
      />

      <div className="flex items-center gap-3.5 py-3.5 pl-[18px] pr-3">
        <span
          className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full ring-1 ring-inset ring-[currentColor]/15 ${cls.iconWrap} ${cls.icon}`}
        >
          <Icon size={17} strokeWidth={2.4} />
        </span>
        <div className="min-w-0 flex-1 text-sm leading-snug">
          {toast.title && (
            <div className="mb-0.5 font-semibold text-foreground">{toast.title}</div>
          )}
          <div className="break-words text-foreground/95">{toast.message}</div>
        </div>
        <button
          type="button"
          onClick={() => dismiss(toast.id)}
          className="-mr-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          aria-label={t('common.close')}
        >
          <X size={13} />
        </button>
      </div>
      {toast.duration > 0 && (
        <>
          {/* Track behind the dismiss bar so the user sees the full
              width even before the bar starts shrinking. */}
          <div className="absolute inset-x-0 bottom-0 h-[3px] bg-foreground/8" aria-hidden />
          <div
            className={`absolute bottom-0 left-0 h-[3px] ${cls.bar}`}
            style={{
              width: mountedBar ? '0%' : '100%',
              transitionProperty: 'width',
              transitionTimingFunction: 'linear',
              transitionDuration: `${toast.duration}ms`,
            }}
            aria-hidden
          />
        </>
      )}
    </motion.div>
  );
}
