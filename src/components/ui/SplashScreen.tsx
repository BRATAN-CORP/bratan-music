import { useEffect, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';

const COLD_START_FLAG = 'bratan:splash-shown';
const MIN_DURATION_MS = 1300;

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
 * The flag is set during the very first render so a parallel initial
 * second mount (React 18 StrictMode dev double-render) does not show
 * two splashes.
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
  /** Override minimum visible duration. Defaults to 1300 ms — long
   *  enough for the full vinyl-spin / sound-wave intro to complete
   *  without overstaying its welcome. */
  minDurationMs?: number;
}

// Equalizer bar count — odd so the centre bar reads as the "tallest"
// resting state and the row feels balanced. Seven matches the band
// width of the wordmark "BRATAN MUSIC" at the chosen letter spacing
// without crowding either edge.
const EQ_BAR_COUNT = 7;
// Per-bar phase offset (seconds). A pseudo-random distribution looks
// more like a real spectrum analyser than a uniform stagger; six
// hand-picked values mean every neighbouring pair lands at clearly
// different heights at any given frame, so the bars never appear to
// move in lock-step.
const EQ_PHASES = [0.0, 0.12, 0.04, 0.18, 0.08, 0.22, 0.14] as const;
// Per-bar peak height (relative). 1.0 is the tallest, 0.45 the
// shortest. The pattern peaks just off-centre and tails outward.
const EQ_PEAKS = [0.55, 0.78, 0.94, 1.0, 0.86, 0.7, 0.5] as const;

/**
 * PWA cold-start splash. Renders a full-screen overlay on top of the
 * router during the first ~1.3s after a cold launch, then fades out
 * once the minimum duration AND the document `load` event have both
 * fired. Subsequent navigations within the same session return null
 * immediately so the animation never re-runs on warm starts.
 *
 * The mark itself is loaded from `/favicon.svg` as an `<img>` so a
 * favicon swap automatically propagates to the cold-start splash —
 * "лого нужно строго брать с фавикона, чтоб когда я менял фавикон,
 * то менялся и лоадер прескрина" (verbatim from the brief). The
 * surrounding chrome (rotating accent ring, concentric sound-wave
 * pulses, equalizer bars under the wordmark) is purely motion / CSS
 * and is the visual differentiator between this redesign and the
 * previous "halo + simple pulse" splash.
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

  // Vite serves the favicon under the configured `base` path
  // (`/bratan-music/`). Using `import.meta.env.BASE_URL` means dev,
  // preview and the production GH-Pages build all resolve correctly
  // without hard-coding the subpath here.
  const faviconHref = `${import.meta.env.BASE_URL}favicon.svg`;

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          aria-hidden
          className="fixed inset-0 z-[9999] flex items-center justify-center overflow-hidden"
          // `--color-bg` is the same surface every other page sits on,
          // so the splash → first-paint transition is just the chrome
          // dissolving rather than a colour swap. Theme-adaptive:
          // light theme paints `#f7f7f5`, dark theme `#0a0a0c`.
          style={{ backgroundColor: 'var(--color-bg)' }}
          initial={false}
          exit={{ opacity: 0, transition: { duration: 0.5, ease: [0.4, 0, 0.2, 1] } }}
        >
          {/* Aurora ambience — same `.aurora` class the home / landing
              hero uses, so the cold-start surface and the first
              rendered route share palette and motion. globals.scss
              kills the animation under reduced-motion anyway, but
              skipping the layer entirely also drops the two extra
              paints. */}
          {!reduce && <div className="aurora" />}

          {/* Soft top-centre spotlight — Linear-style highlight that
              pulls the eye toward the brand mark without competing
              with the rotating accent ring underneath. */}
          {!reduce && (
            <motion.div
              className="pointer-events-none absolute left-1/2 top-[-12%] h-[640px] w-[820px] -translate-x-1/2 rounded-full blur-3xl"
              style={{
                background:
                  'radial-gradient(ellipse, var(--color-accent-glow) 0%, transparent 65%)',
                opacity: 0.85,
              }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.85 }}
              transition={{ duration: 0.6 }}
            />
          )}

          <motion.div
            className="relative z-10 flex flex-col items-center gap-7"
            initial={{ opacity: 0, y: 8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
          >
            {/* Logo stage — fixed-size square that contains the rotating
                conic ring, the concentric sound-wave pulses and the
                <img>-loaded favicon all centred on a single origin. */}
            <div className="relative h-[148px] w-[148px]">
              {/* Concentric sound-wave pulses — three overlapping rings
                  scale up from the logo and fade out, staggered by 0.5s
                  so a new wave starts before the previous fully fades.
                  Reads unmistakably as "audio". */}
              {!reduce &&
                [0, 0.5, 1.0].map((delay) => (
                  <motion.span
                    key={delay}
                    className="pointer-events-none absolute inset-0 rounded-full"
                    style={{
                      border: '1.5px solid var(--color-accent)',
                      opacity: 0,
                    }}
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: [0.8, 1.7], opacity: [0.55, 0] }}
                    transition={{
                      duration: 1.5,
                      repeat: Infinity,
                      ease: 'easeOut',
                      delay,
                    }}
                  />
                ))}

              {/* Rotating conic-gradient accent ring — vinyl-record
                  cue. The conic stops are positioned so two-thirds of
                  the ring is transparent and a third is the accent
                  sweep, which is what makes the rotation read as
                  motion (a fully-lit ring would just sit there).
                  `rotate` keyframes drive a continuous spin via the
                  GPU compositor (transform-only, no layout). */}
              {!reduce && (
                <motion.span
                  className="pointer-events-none absolute inset-[-6px] rounded-full"
                  style={{
                    background:
                      'conic-gradient(from 0deg, transparent 0deg, transparent 240deg, var(--color-accent) 320deg, transparent 360deg)',
                    // Mask cuts the centre out so only the ring shows;
                    // gives the rotating sweep a clean halo around the
                    // logo instead of bleeding over it.
                    WebkitMask:
                      'radial-gradient(circle, transparent 60%, #000 62%, #000 100%)',
                    mask:
                      'radial-gradient(circle, transparent 60%, #000 62%, #000 100%)',
                    opacity: 0.8,
                  }}
                  animate={{ rotate: 360 }}
                  transition={{ duration: 4.5, repeat: Infinity, ease: 'linear' }}
                />
              )}

              {/* Logo plate — the favicon SVG rendered as an <img> so
                  any future favicon swap propagates here automatically
                  (per the user's "лого нужно строго брать с фавикона"
                  brief). Square plate with a soft accent drop-shadow
                  echoes the conic ring colour without doubling up the
                  surface area. */}
              <div
                className="absolute inset-[18px] flex items-center justify-center"
                style={{ filter: 'drop-shadow(0 12px 36px var(--color-accent-glow))' }}
              >
                {!reduce ? (
                  <motion.img
                    src={faviconHref}
                    alt=""
                    width={112}
                    height={112}
                    draggable={false}
                    className="h-[112px] w-[112px] select-none"
                    initial={{ scale: 0.94 }}
                    animate={{ scale: [0.94, 1, 0.94] }}
                    transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut' }}
                  />
                ) : (
                  <img
                    src={faviconHref}
                    alt=""
                    width={112}
                    height={112}
                    draggable={false}
                    className="h-[112px] w-[112px] select-none"
                  />
                )}
              </div>
            </div>

            {/* Wordmark + equalizer ribbon — replaces the previous
                two-line "BRATAN / MUSIC" stack. Single-line wordmark
                reads as a single brand unit instead of two stacked
                labels, and the equalizer beneath ties the typographic
                rhythm directly to the music-app metaphor. */}
            <div className="flex flex-col items-center gap-3">
              <p
                className="text-[15px] font-semibold tracking-[0.42em]"
                style={{ color: 'var(--color-text)' }}
              >
                BRATAN <span style={{ color: 'var(--color-accent)' }}>MUSIC</span>
              </p>

              {/* Equalizer bars — `EQ_BAR_COUNT` thin pills whose
                  heights oscillate between a base and a per-bar peak
                  with a pseudo-random phase offset so the row never
                  reads as a synced sweep. Reduced-motion path renders
                  the bars at their resting peaks (no animation),
                  which still communicates "audio levels" without any
                  movement. */}
              <div
                aria-hidden
                className="flex items-end gap-[3px]"
                style={{ height: 18 }}
              >
                {Array.from({ length: EQ_BAR_COUNT }).map((_, i) => {
                  const peak = EQ_PEAKS[i] ?? 0.6;
                  const phase = EQ_PHASES[i] ?? 0;
                  const restPx = Math.max(4, Math.round(18 * peak * 0.4));
                  const peakPx = Math.round(18 * peak);
                  return (
                    <motion.span
                      key={i}
                      className="block w-[3px] rounded-full"
                      style={{
                        backgroundColor: 'var(--color-accent)',
                        height: reduce ? peakPx : restPx,
                      }}
                      {...(reduce
                        ? {}
                        : {
                            animate: { height: [restPx, peakPx, restPx] },
                            transition: {
                              duration: 0.85 + (i % 3) * 0.1,
                              repeat: Infinity,
                              ease: 'easeInOut',
                              delay: phase,
                            },
                          })}
                    />
                  );
                })}
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
