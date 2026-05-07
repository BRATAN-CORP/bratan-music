import { motion, useReducedMotion } from 'motion/react';
import { useT } from '@/i18n';

interface PageLoaderProps {
  /** Optional override label below the dots. Falls back to the localised
   *  `common.loading` copy when omitted. */
  label?: string;
  /** "page" → tall flex column suitable for hero / page-level loading
   *  states (~50svh of vertical space). "inline" → compact strip with
   *  the dots + label, for in-card / list-header spinners. */
  variant?: 'page' | 'inline';
  /** Tailwind override for the wrapper. */
  className?: string;
}

/**
 * Shared loader surface used by every async page boundary in the app.
 *
 * Design principles (from the user's brief — verbatim: «я просил
 * аккуратную просто анимацию загрузки, а не лепить логотип и тем
 * более какой-то акцентный цвет там. сделай короче согласно дизайн
 * проекту всего приложения»):
 *
 *   - **No logo.** The splash is the place for the brand mark;
 *     loaders should be ambient UI, not branded surfaces.
 *   - **No accent colour.** Loaders run on every page, so the dots
 *     are bound to `--color-text-muted` and inherit the same
 *     "secondary text" tone the rest of the UI uses for paragraphs
 *     and metadata — drawing in accent purple every time we wait on
 *     the network would turn the loader into a foreground element.
 *   - **Three-dot wave** is the same restrained pattern Linear /
 *     Vercel use; reads as "we're working" without competing with
 *     the rest of the page composition.
 *   - **Reduced motion** collapses the animation to three static
 *     dots at 50% opacity so the loader still communicates "loading"
 *     without violating the user's OS preference.
 */
const DOT_DELAYS = [0, 0.16, 0.32] as const;

export function PageLoader({
  label,
  variant = 'page',
  className = '',
}: PageLoaderProps) {
  const t = useT();
  const reduce = useReducedMotion();
  const text = label ?? t('common.loading');

  const dotSize = variant === 'inline' ? 4 : 7;
  const dotGap = variant === 'inline' ? 4 : 6;

  const dots = (
    <div
      aria-hidden
      className="flex items-center"
      style={{ gap: dotGap }}
    >
      {DOT_DELAYS.map((delay, i) => (
        <motion.span
          key={i}
          className="block rounded-full"
          style={{
            width: dotSize,
            height: dotSize,
            backgroundColor: 'var(--color-text-muted)',
            opacity: reduce ? 0.5 : undefined,
          }}
          {...(reduce
            ? {}
            : {
                animate: { opacity: [0.25, 1, 0.25], y: [0, -2, 0] },
                transition: {
                  duration: 1.0,
                  repeat: Infinity,
                  ease: 'easeInOut',
                  delay,
                },
              })}
        />
      ))}
    </div>
  );

  if (variant === 'inline') {
    return (
      <div
        role="status"
        aria-live="polite"
        className={`flex items-center gap-2.5 text-sm text-muted-foreground ${className}`}
      >
        {dots}
        <span>{text}</span>
      </div>
    );
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className={`flex min-h-[40svh] flex-col items-center justify-center gap-4 py-12 ${className}`}
    >
      {dots}
      <p className="text-sm text-muted-foreground">{text}</p>
    </div>
  );
}
