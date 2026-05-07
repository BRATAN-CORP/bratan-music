import { useEffect, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { BrandLogo } from '@/components/ui/BrandLogo';

const COLD_START_FLAG = 'bratan:splash-shown';
const MIN_DURATION_MS = 1100;

/**
 * Returns true on the very first paint of a cold-started session and
 * false on every subsequent navigation / hot-reload during the same
 * session.
 *
 * Cold-start detection rationale: `sessionStorage` is scoped per
 * browsing context — it survives in-app navigations and React hot
 * reloads, but is wiped when the OS terminates the PWA process (the
 * user swiping the app off the iOS multitasking tray, an Android
 * "kill background" event, the browser tab being closed). That's
 * exactly the user's spec: "анимация не должна запускаться каждый
 * раз когда мы входим, а только когда мы допустим из трея или
 * списка запущенных приложений убрали, и запускаем на холодную".
 *
 * The flag is also set during the very first render so a parallel
 * initial second mount (React 18 StrictMode dev double-render) does
 * not show two splashes.
 */
function useIsColdStart(): boolean {
  const [isCold] = useState(() => {
    if (typeof window === 'undefined') return false;
    try {
      const already = window.sessionStorage.getItem(COLD_START_FLAG);
      if (already) return false;
      window.sessionStorage.setItem(COLD_START_FLAG, '1');
      return true;
    } catch {
      // Private browsing on iOS Safari throws on sessionStorage writes —
      // err on the side of NOT showing the splash (better than showing
      // it on every navigation in private mode).
      return false;
    }
  });
  return isCold;
}

interface SplashScreenProps {
  /** Override minimum visible duration. Defaults to 1100 ms — enough
   *  for the breathe + fade animation to complete without lingering. */
  minDurationMs?: number;
}

/**
 * PWA cold-start splash. Renders a full-screen overlay on top of the
 * router during the first ~1.1s after a cold launch, then fades out
 * once the minimum duration AND the document `load` event have both
 * fired. Subsequent navigations within the same session return null
 * immediately so the animation never re-runs on warm starts.
 *
 * The mark is the same `<BrandLogo>` used by the favicon so a
 * favicon swap propagates here automatically — also part of the
 * user's brief: "лого нужно строго брать с фавикона или откуда-то,
 * чтоб когда я менял фавикон, то менялся и лоадер прескрина".
 */
export function SplashScreen({ minDurationMs = MIN_DURATION_MS }: SplashScreenProps = {}) {
  const isCold = useIsColdStart();
  const reduce = useReducedMotion();
  const [visible, setVisible] = useState(isCold);

  useEffect(() => {
    if (!isCold) return;
    const start = performance.now();

    let timeoutId: number | undefined;
    const finish = () => {
      const elapsed = performance.now() - start;
      const remaining = Math.max(0, minDurationMs - elapsed);
      timeoutId = window.setTimeout(() => setVisible(false), remaining);
    };

    if (document.readyState === 'complete') {
      finish();
    } else {
      window.addEventListener('load', finish, { once: true });
      // Belt-and-braces ceiling — a stalled `load` event (offline
      // CDN, service-worker still installing) shouldn't trap the
      // user behind the splash forever.
      timeoutId = window.setTimeout(() => setVisible(false), minDurationMs + 1500);
    }
    return () => {
      window.removeEventListener('load', finish);
      if (timeoutId) window.clearTimeout(timeoutId);
    };
  }, [isCold, minDurationMs]);

  if (!isCold) return null;

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          aria-hidden
          className="fixed inset-0 z-[9999] flex items-center justify-center overflow-hidden"
          // `--color-bg` is the same surface every other page sits on,
          // so the splash → first-paint transition is just the blobs
          // dissolving rather than a colour swap. Theme-adaptive:
          // light theme paints `#f7f7f5`, dark theme `#0a0a0c`.
          style={{ backgroundColor: 'var(--color-bg)' }}
          initial={false}
          exit={{ opacity: 0, transition: { duration: 0.45, ease: [0.4, 0, 0.2, 1] } }}
        >
          {/* Aurora ambience — exactly mirrors the home / landing
              hero (`.aurora` in globals.scss) so the cold-start
              surface and the first rendered route share the same
              palette and motion. The class drives two `::before` /
              `::after` accent blobs with `aurora-1` / `aurora-2`
              keyframes already vetted for performance on iOS Safari.
              We only mount it when the OS isn't asking for reduced
              motion — globals.scss kills the animation in that case
              anyway, but skipping the layer entirely also drops the
              two extra paints. */}
          {!reduce && <div className="aurora" />}

          {/* Soft top-centre highlight — Linear-style spotlight that
              draws the eye toward the brand mark without competing
              with the rotating aurora blobs underneath. */}
          {!reduce && (
            <motion.div
              className="pointer-events-none absolute left-1/2 top-[-12%] h-[640px] w-[820px] -translate-x-1/2 rounded-full blur-3xl"
              style={{
                background:
                  'radial-gradient(ellipse, var(--color-accent-glow) 0%, transparent 65%)',
                opacity: 0.9,
              }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.9 }}
              transition={{ duration: 0.6 }}
            />
          )}

          <motion.div
            className="relative z-10 flex flex-col items-center gap-6"
            initial={{ opacity: 0, y: 8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="relative">
              {!reduce && (
                <motion.span
                  className="absolute -inset-10 rounded-full blur-2xl"
                  style={{
                    background:
                      'radial-gradient(circle, var(--color-accent) 0%, transparent 70%)',
                    opacity: 0.4,
                  }}
                  animate={{ opacity: [0.25, 0.55, 0.25], scale: [0.9, 1.1, 0.9] }}
                  transition={{ duration: 2.0, repeat: Infinity, ease: 'easeInOut' }}
                />
              )}
              {/* Halo bound to the live accent token via the wrapper
                  so it tracks the favicon swap (same SVG, same
                  `--color-accent`) without forcing `BrandLogo` to
                  expose a `style` prop. */}
              <div
                className="relative z-10"
                style={{ filter: 'drop-shadow(0 8px 32px var(--color-accent-glow))' }}
              >
                <BrandLogo size={120} pulse />
              </div>
            </div>
            <div className="flex flex-col items-center gap-1">
              <p
                className="text-base font-semibold tracking-[0.4em]"
                style={{ color: 'var(--color-text)' }}
              >
                BRATAN
              </p>
              <p
                className="text-[11px] font-medium uppercase tracking-[0.35em]"
                style={{ color: 'var(--color-text-muted)' }}
              >
                MUSIC
              </p>
            </div>
            {!reduce && (
              <motion.div
                className="mt-2 h-0.5 w-24 overflow-hidden rounded-full"
                style={{ backgroundColor: 'var(--color-border)' }}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.35 }}
              >
                <motion.span
                  className="block h-full"
                  style={{
                    background:
                      'linear-gradient(90deg, transparent, var(--color-accent), transparent)',
                  }}
                  initial={{ x: '-100%', width: '50%' }}
                  animate={{ x: '200%' }}
                  transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
                />
              </motion.div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
