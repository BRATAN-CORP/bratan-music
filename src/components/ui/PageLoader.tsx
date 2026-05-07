import { motion, useReducedMotion } from 'motion/react';
import { BrandLogo } from '@/components/ui/BrandLogo';
import { useT } from '@/i18n';

interface PageLoaderProps {
  /** Optional override label below the logo. Falls back to the localised
   *  `common.loading` copy when omitted. */
  label?: string;
  /** "page" → tall flex column suitable for hero / page-level loading
   *  states (~50svh of vertical space). "inline" → compact strip with
   *  the same logo + label, for in-card / list-header spinners. */
  variant?: 'page' | 'inline';
  /** Tailwind override for the wrapper. */
  className?: string;
}

/**
 * Shared loader surface used by every async page boundary in the app.
 *
 * Replaces the historical pattern of `<p>{t('xxx.loading')}</p>` —
 * the user's brief explicitly called out "красивые лоадеры всех
 * страниц" (beautiful loaders for absolutely all pages where we
 * wait for the server). The animation pulses the same logo as the
 * favicon + cold-start splash so the three surfaces visually rhyme:
 * the user sees the same mark on launch, on every loading screen,
 * and as the home-screen icon.
 *
 * Animation primitives:
 *   - `BrandLogo pulse` does the breathe / play-triangle fade
 *   - the orbiting halo arc gives a discrete "indeterminate" cue
 *     so a long stall reads as "still working" instead of "stuck"
 *   - the `prefers-reduced-motion` path collapses both to a static
 *     mark + label
 */
export function PageLoader({
  label,
  variant = 'page',
  className = '',
}: PageLoaderProps) {
  const t = useT();
  const reduce = useReducedMotion();
  const text = label ?? t('common.loading');

  if (variant === 'inline') {
    return (
      <div
        role="status"
        aria-live="polite"
        className={`flex items-center gap-2.5 text-sm text-muted-foreground ${className}`}
      >
        <span className="relative inline-flex h-5 w-5 items-center justify-center">
          <BrandLogo size={20} pulse />
          {!reduce && (
            <motion.span
              aria-hidden
              className="absolute -inset-1.5 rounded-full"
              style={{
                background:
                  'radial-gradient(circle, rgba(30, 217, 95, 0.35) 0%, transparent 70%)',
              }}
              animate={{ opacity: [0.5, 0.9, 0.5], scale: [0.9, 1.08, 0.9] }}
              transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
            />
          )}
        </span>
        <span>{text}</span>
      </div>
    );
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className={`flex min-h-[40svh] flex-col items-center justify-center gap-5 py-12 ${className}`}
    >
      <div className="relative inline-flex h-20 w-20 items-center justify-center">
        {!reduce && (
          <>
            {/* Soft accent halo — mirrors `Aurora` so the loader
                doesn't look like a foreign UI element parachuted
                onto the page. */}
            <motion.span
              aria-hidden
              className="absolute -inset-6 rounded-full blur-2xl"
              style={{
                background:
                  'radial-gradient(circle, rgba(30, 217, 95, 0.42) 0%, transparent 65%)',
              }}
              animate={{ opacity: [0.45, 0.8, 0.45], scale: [0.9, 1.08, 0.9] }}
              transition={{ duration: 2.0, repeat: Infinity, ease: 'easeInOut' }}
            />
            {/* Indeterminate orbit — a thin conic arc rotating around
                the logo. Even when the cover image is bound to the
                pulsing brand-logo, the orbit gives a clear "this is
                progressing, not frozen" signal that translates well
                to slow connections. */}
            <motion.span
              aria-hidden
              className="absolute inset-0 rounded-full"
              style={{
                background:
                  'conic-gradient(from 0deg, transparent 0deg, transparent 270deg, rgba(30, 217, 95, 0.7) 320deg, transparent 360deg)',
                WebkitMask:
                  'radial-gradient(circle, transparent 56%, #000 58%, #000 100%)',
                mask:
                  'radial-gradient(circle, transparent 56%, #000 58%, #000 100%)',
              }}
              animate={{ rotate: 360 }}
              transition={{ duration: 1.6, repeat: Infinity, ease: 'linear' }}
            />
          </>
        )}
        <BrandLogo size={56} pulse className="relative z-10 drop-shadow-[0_4px_18px_rgba(30,217,95,0.35)]" />
      </div>
      <motion.p
        className="text-sm text-muted-foreground"
        initial={reduce ? false : { opacity: 0, y: 4 }}
        animate={reduce ? undefined : { opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.1 }}
      >
        {text}
      </motion.p>
    </div>
  );
}
