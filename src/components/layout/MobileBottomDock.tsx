import { useNavigate, NavLink } from 'react-router-dom';
import { Play, Pause, SkipForward, Heart, Maximize2, Compass, Search, Library, User as UserIcon, Home } from 'lucide-react';
import { motion, AnimatePresence, useReducedMotion, useTransform, type MotionValue } from 'motion/react';
import { usePlayerStore } from '@/store/player';
import { seekAudio, usePlaybackVisuals } from '@/hooks/useAudioPlayer';
import { useToggleLike } from '@/hooks/useLibrary';
import { Marquee } from '@/components/ui/Marquee';
import { SwipeTrackStrip } from '@/components/layout/SwipeTrackStrip';

const navItems = [
  { to: '/', icon: Home, label: 'Главная' },
  { to: '/search', icon: Search, label: 'Поиск' },
  { to: '/explore', icon: Compass, label: 'Обзор' },
  { to: '/library', icon: Library, label: 'Библиотека' },
  { to: '/profile', icon: UserIcon, label: 'Профиль' },
] as const;

/**
 * Unified mobile bottom dock — a SINGLE liquid-glass surface that
 * contains the mini-player and the bottom-nav as two stacked rows.
 *
 * Replaces the previous two-fixed-cards approach (Player floating
 * above BottomNav, glued via `.no-foot` / `.no-lip` shadow modifiers).
 * Even with the seam-aware shadow recipe the inner highlights of each
 * card painted along the shared edge, leaving a visible bright line
 * between the two surfaces and small "ear" reflections at the corners
 * — exactly the issue flagged in the design review. Putting both rows
 * inside one card erases the seam by construction: there is now only
 * one bezel, painted around the outer perimeter, and the inner
 * divider between the player row and the nav row is a 1px translucent
 * hairline.
 *
 * Hidden on lg+ — desktop keeps the floating Player and the Sidebar
 * for navigation.
 */
export function MobileBottomDock() {
  const {
    currentTrack, isPlaying, togglePlay, nextManual,
    duration, progress, fullscreen, openFullscreen,
  } = usePlayerStore();
  const { progressSeconds, durationSeconds } = usePlaybackVisuals();
  const reduce = useReducedMotion();
  const navigate = useNavigate();
  const { isLiked, toggle } = useToggleLike();

  const progressWidth = useTransform(
    [progressSeconds as MotionValue<number>, durationSeconds as MotionValue<number>],
    (values) => {
      const [t, d] = values as [number, number];
      return d > 0 ? `${Math.min(100, (t / d) * 100)}%` : '0%';
    },
  );

  if (fullscreen) return null;
  const liked = currentTrack ? isLiked(currentTrack.id) : false;

  return (
    <div
      className="fixed bottom-[calc(env(safe-area-inset-bottom,0px)+1rem)] left-4 right-4 z-40 flex flex-col overflow-hidden rounded-[var(--radius-xl)] liquid-glass sm:bottom-[calc(env(safe-area-inset-bottom,0px)+1.5rem)] sm:left-6 sm:right-6 lg:hidden"
    >
      <AnimatePresence initial={false}>
        {currentTrack && (
          <motion.div
            key="player-row"
            initial={reduce ? false : { height: 0, opacity: 0 }}
            animate={reduce ? undefined : { height: 'auto', opacity: 1 }}
            exit={reduce ? undefined : { height: 0, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            className="flex flex-col"
          >
            {/* Progress bar — thin rail FLUSH with the dock's top edge.
                No padding wrapper above (a previous attempt at hosting
                the thumb in extra hit-area was eating cover taps that
                landed near the top of the cover image and broke the
                'tap cover → open fullscreen' gesture).

                Mobile-native pattern: the rail is invisible-thin at
                rest (3px) and grows to 6px while the user is hovering
                (desktop) or actively dragging (touch). The thumb is
                rendered INSIDE the expanded rail at the playhead edge,
                so it's always fully contained — no clipping by the
                dock's `overflow-hidden`, no z-index conflict with
                neighbouring buttons, and nothing extends above the
                rail to steal taps from the cover button. */}
            <div
              className="group/progress relative w-full shrink-0 cursor-pointer touch-none select-none"
              role="slider"
              aria-label="Перемотка"
              aria-valuemin={0}
              aria-valuemax={Math.max(1, Math.round(duration))}
              aria-valuenow={Math.round(progress)}
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                const rect = e.currentTarget.getBoundingClientRect();
                const seekFromX = (clientX: number) => {
                  const pct = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
                  seekAudio(pct * duration);
                };
                seekFromX(e.clientX);
                const target = e.currentTarget;
                const onMove = (ev: PointerEvent) => seekFromX(ev.clientX);
                const onUp = (ev: PointerEvent) => {
                  seekFromX(ev.clientX);
                  target.removeEventListener('pointermove', onMove);
                  target.removeEventListener('pointerup', onUp);
                  target.removeEventListener('pointercancel', onUp);
                  try { target.releasePointerCapture(ev.pointerId); } catch { /* ignore */ }
                };
                target.addEventListener('pointermove', onMove);
                target.addEventListener('pointerup', onUp);
                target.addEventListener('pointercancel', onUp);
              }}
            >
              <div className="relative h-[3px] w-full overflow-hidden bg-white/[0.08] transition-[height] duration-150 group-hover/progress:h-1.5 group-active/progress:h-1.5">
                <motion.div
                  className="absolute inset-y-0 left-0 bg-gradient-to-r from-[var(--color-accent)] via-[var(--color-sub-accent)] to-[var(--color-accent)]"
                  style={{ width: progressWidth }}
                />
                {/* Thumb lives INSIDE the rail container so it
                    inherits the rail's expanded height. At rest the
                    rail is 3px tall and the 1.5×1.5 thumb is barely
                    visible inside it (matches Spotify's "no thumb at
                    rest" feel). On hover/active the rail grows to 6px
                    and the thumb scales up to 2.5×2.5 — fully
                    contained by the rail, no clipping. */}
                <motion.div
                  aria-hidden
                  className="pointer-events-none absolute top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white opacity-0 transition-opacity duration-150 group-hover/progress:opacity-100 group-active/progress:opacity-100"
                  style={{ left: progressWidth }}
                />
              </div>
            </div>

            <div
              className="flex cursor-pointer items-center gap-3 px-3 py-2.5"
              role="button"
              tabIndex={0}
              aria-label="Открыть плеер"
              onClick={(e) => {
                // Whole row opens fullscreen, except when the click lands on
                // an interactive control (cover/title also openFullscreen on
                // their own; artist/like/play/next handle their own actions
                // and the closest('button') guard prevents a second call).
                const t = e.target as HTMLElement | null;
                if (t?.closest('button, a')) return;
                openFullscreen();
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  openFullscreen();
                }
              }}
            >
              {/* П9 — swipe horizontally on the cover/title strip to
                  navigate prev/next. Tapping still opens fullscreen
                  via the parent click handler. The strip mounts both
                  prev and next track ghosts behind the soft edge
                  fade so the gesture has clear visual affordance. */}
              <SwipeTrackStrip className="min-w-0 flex-1">
                {(t, position) => (
                  <div
                    className="flex items-center gap-3"
                    style={{ opacity: position === 'current' ? 1 : 0.6 }}
                  >
                    <button
                      type="button"
                      onClick={position === 'current' ? openFullscreen : undefined}
                      aria-label="Открыть плеер"
                      tabIndex={position === 'current' ? 0 : -1}
                      className="group relative h-11 w-11 shrink-0 overflow-hidden rounded-[var(--radius-sm)] border border-white/10"
                    >
                      {t.coverUrl ? (
                        <img src={t.coverUrl} alt={t.title} className="h-full w-full object-cover" />
                      ) : (
                        <div className="h-full w-full bg-white/5" />
                      )}
                      {position === 'current' && (
                        <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
                          <Maximize2 size={14} className="text-white" />
                        </div>
                      )}
                    </button>
                    <div className="min-w-0 flex-1">
                      <button
                        type="button"
                        onClick={position === 'current' ? openFullscreen : undefined}
                        tabIndex={position === 'current' ? 0 : -1}
                        className="block w-full text-left text-sm font-medium leading-tight"
                        aria-label="Открыть плеер"
                      >
                        <Marquee text={t.title} />
                      </button>
                      {position === 'current' && t.artistId ? (
                        <button
                          type="button"
                          onClick={() => navigate(`/artist/${t.artistId}`)}
                          className="block w-full text-left text-xs text-muted-foreground transition-colors hover:text-foreground"
                          aria-label={`Открыть артиста ${t.artist}`}
                        >
                          <Marquee text={t.artist} />
                        </button>
                      ) : (
                        <Marquee text={t.artist} className="text-xs text-muted-foreground" />
                      )}
                    </div>
                  </div>
                )}
              </SwipeTrackStrip>

              <button
                type="button"
                onClick={() => currentTrack && toggle(currentTrack)}
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-[transform,colors,background-color] active:scale-90 hover:bg-[var(--color-hover-overlay)] hover:text-foreground ${liked ? 'text-[var(--color-accent)]' : ''}`}
                aria-label={liked ? 'Убрать лайк' : 'Лайк'}
              >
                <Heart size={16} fill={liked ? 'currentColor' : 'none'} />
              </button>

              <button
                type="button"
                onClick={togglePlay}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--color-accent)] text-[var(--color-text-on-accent)] shadow-[0_2px_8px_-2px_var(--color-accent-glow)] transition-[transform,box-shadow] active:scale-95 hover:shadow-[0_4px_16px_-4px_var(--color-accent-glow)]"
                aria-label={isPlaying ? 'Пауза' : 'Пуск'}
              >
                {isPlaying ? <Pause size={16} fill="currentColor" strokeWidth={0} /> : <Play size={16} fill="currentColor" />}
              </button>

              <button
                type="button"
                onClick={nextManual}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-[transform,colors,background-color] active:scale-90 hover:bg-[var(--color-hover-overlay)] hover:text-foreground"
                aria-label="Следующий"
              >
                <SkipForward size={16} />
              </button>
            </div>

            {/* Hairline divider between player row and nav row. Single
                1px translucent line — the bezel itself is shared, so no
                second border is required. */}
            <div aria-hidden className="mx-3 h-px shrink-0 bg-white/[0.07]" />
          </motion.div>
        )}
      </AnimatePresence>

      <nav className="flex h-14 items-center justify-around">
        {navItems.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              `relative flex min-w-[60px] flex-col items-center gap-0.5 px-2 py-1 text-[11px] font-medium transition-colors ${
                isActive ? 'text-foreground' : 'text-muted-foreground'
              }`
            }
          >
            <Icon size={18} />
            {label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
