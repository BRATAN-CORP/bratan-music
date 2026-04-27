import { useNavigate, NavLink } from 'react-router-dom';
import { Play, Pause, SkipForward, Heart, Maximize2, Search, Library, User as UserIcon, Home } from 'lucide-react';
import { motion, AnimatePresence, useReducedMotion, useTransform } from 'motion/react';
import { usePlayerStore } from '@/store/player';
import { useAudioPlayer, usePlaybackVisuals } from '@/hooks/useAudioPlayer';
import { useToggleLike } from '@/hooks/useLibrary';

const navItems = [
  { to: '/', icon: Home, label: 'Главная' },
  { to: '/search', icon: Search, label: 'Поиск' },
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
    duration, fullscreen, openFullscreen,
  } = usePlayerStore();
  const { seek } = useAudioPlayer();
  const { progressSeconds, durationSeconds } = usePlaybackVisuals();
  const reduce = useReducedMotion();
  const navigate = useNavigate();
  const { isLiked, toggle } = useToggleLike();

  const progressWidth = useTransform(
    [progressSeconds, durationSeconds] as unknown as never,
    ([t, d]: [number, number]) => (d > 0 ? `${Math.min(100, (t / d) * 100)}%` : '0%'),
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
            {/* Progress bar — thin rail flush with the dock's top edge.
                Tap-to-seek; the draggable thumb lives in the fullscreen
                player to keep the dock surface clean. */}
            <div
              className="group/progress relative h-[3px] w-full shrink-0 cursor-pointer touch-none overflow-hidden bg-white/[0.06] transition-[height] duration-150 select-none hover:h-1.5 active:h-1.5"
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                const rect = e.currentTarget.getBoundingClientRect();
                const seekFromX = (clientX: number) => {
                  const pct = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
                  seek(pct * duration);
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
              <motion.div
                className="absolute inset-y-0 left-0 bg-gradient-to-r from-[var(--color-accent)] via-[var(--color-sub-accent)] to-[var(--color-accent)]"
                style={{ width: progressWidth }}
              />
            </div>

            <div className="flex items-center gap-3 px-3 py-2.5">
              {/* Cover + title open the fullscreen player; the artist
                  is a separate inline link. */}
              <button
                type="button"
                onClick={openFullscreen}
                aria-label="Открыть плеер"
                className="group relative h-11 w-11 shrink-0 overflow-hidden rounded-[var(--radius-sm)] border border-white/10"
              >
                {currentTrack.coverUrl ? (
                  <img src={currentTrack.coverUrl} alt={currentTrack.title} className="h-full w-full object-cover" />
                ) : (
                  <div className="h-full w-full bg-white/5" />
                )}
                <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
                  <Maximize2 size={14} className="text-white" />
                </div>
              </button>

              <div className="min-w-0 flex-1">
                <button
                  type="button"
                  onClick={openFullscreen}
                  className="block w-full truncate text-left text-sm font-medium leading-tight"
                  aria-label="Открыть плеер"
                >
                  {currentTrack.title}
                </button>
                {currentTrack.artistId ? (
                  <button
                    type="button"
                    onClick={() => navigate(`/artist/${currentTrack.artistId}`)}
                    className="block w-full truncate text-left text-xs text-muted-foreground transition-colors hover:text-foreground"
                    aria-label={`Открыть артиста ${currentTrack.artist}`}
                  >
                    {currentTrack.artist}
                  </button>
                ) : (
                  <p className="truncate text-xs text-muted-foreground">{currentTrack.artist}</p>
                )}
              </div>

              <motion.button
                type="button"
                onClick={() => currentTrack && toggle(currentTrack)}
                whileTap={reduce ? undefined : { scale: 0.85 }}
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-[var(--color-hover-overlay)] hover:text-foreground ${liked ? 'text-[var(--color-accent)]' : ''}`}
                aria-label={liked ? 'Убрать лайк' : 'Лайк'}
              >
                <Heart size={16} fill={liked ? 'currentColor' : 'none'} />
              </motion.button>

              <motion.button
                type="button"
                onClick={togglePlay}
                whileTap={reduce ? undefined : { scale: 0.92 }}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--color-accent)] text-[var(--color-text-on-accent)] shadow-[0_2px_8px_-2px_var(--color-accent-glow)] transition-shadow hover:shadow-[0_4px_16px_-4px_var(--color-accent-glow)]"
                aria-label={isPlaying ? 'Пауза' : 'Пуск'}
              >
                {isPlaying ? <Pause size={16} fill="currentColor" strokeWidth={0} /> : <Play size={16} fill="currentColor" />}
              </motion.button>

              <button
                type="button"
                onClick={nextManual}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-[var(--color-hover-overlay)] hover:text-foreground"
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
