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
          className="fixed inset-0 z-[9999] flex items-center justify-center"
          style={{ backgroundColor: '#0a0a0c' }}
          initial={false}
          exit={{ opacity: 0, transition: { duration: 0.45, ease: [0.4, 0, 0.2, 1] } }}
        >
          {/* Soft accent ambience — same palette family as the
              loader / Aurora hero, so the cold-start surface
              telegraphs "you're in the right app" before any
              data has rendered. */}
          {!reduce && (
            <>
              <motion.div
                className="pointer-events-none absolute -top-40 left-1/2 h-[640px] w-[820px] -translate-x-1/2 rounded-full blur-3xl"
                style={{
                  background:
                    'radial-gradient(ellipse, rgba(30, 217, 95, 0.32) 0%, transparent 65%)',
                }}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.6 }}
              />
              <motion.div
                className="pointer-events-none absolute -bottom-32 right-[-20%] h-[480px] w-[640px] rounded-full blur-3xl"
                style={{
                  background:
                    'radial-gradient(circle, rgba(126, 137, 232, 0.22) 0%, transparent 70%)',
                }}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.7, delay: 0.1 }}
              />
            </>
          )}
          <motion.div
            className="relative flex flex-col items-center gap-6"
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
                      'radial-gradient(circle, rgba(30, 217, 95, 0.55) 0%, transparent 70%)',
                  }}
                  animate={{ opacity: [0.5, 0.95, 0.5], scale: [0.9, 1.1, 0.9] }}
                  transition={{ duration: 2.0, repeat: Infinity, ease: 'easeInOut' }}
                />
              )}
              <BrandLogo
                size={120}
                pulse
                className="relative z-10 drop-shadow-[0_8px_32px_rgba(30,217,95,0.45)]"
              />
            </div>
            <div className="flex flex-col items-center gap-1">
              <p className="text-base font-semibold tracking-[0.4em] text-white/90">BRATAN</p>
              <p className="text-[11px] font-medium uppercase tracking-[0.35em] text-white/50">
                MUSIC
              </p>
            </div>
            {!reduce && (
              <motion.div
                className="mt-2 h-0.5 w-24 overflow-hidden rounded-full bg-white/10"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.35 }}
              >
                <motion.span
                  className="block h-full"
                  style={{
                    background:
                      'linear-gradient(90deg, transparent, rgba(30, 217, 95, 0.95), transparent)',
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
