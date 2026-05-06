import { useState } from 'react';
import { useNavigate, NavLink } from 'react-router-dom';
import { Play, Pause, SkipForward, Heart, Maximize2, Search, Library, User as UserIcon, Home } from 'lucide-react';
import { motion, AnimatePresence, useReducedMotion, useTransform, type MotionValue } from 'motion/react';
import { usePlayerStore } from '@/store/player';
import { seekAudio, usePlaybackVisuals } from '@/hooks/useAudioPlayer';
import { useToggleLike } from '@/hooks/useLibrary';
import { Marquee } from '@/components/ui/Marquee';
import { CoverFallback } from '@/components/ui/CoverFallback';
import { SwipeTrackStrip } from '@/components/layout/SwipeTrackStrip';
import { ArtistLinks } from '@/components/features/ArtistLinks';
import { useOfflineCoverUrl } from '@/hooks/useOfflineCoverUrl';
import type { Track } from '@/types';
import { useT, type TranslationKey } from '@/i18n';

/**
 * `<CoverFallback>` wrapper that resolves the cover URL through the
 * offline cache so saved tracks keep painting real artwork even when
 * the device is offline. Falls back to the network URL when the
 * track isn't saved offline. Lifted into its own component so we
 * can call the `useOfflineCoverUrl` hook once per track inside the
 * `SwipeTrackStrip` render prop (current + prev + next slots).
 */
function StripCover({
  track,
  alt,
  initialsClassName,
}: {
  track: Track;
  alt: string;
  initialsClassName?: string;
}) {
  const coverUrl = useOfflineCoverUrl('track', track.id, track.coverUrl);
  return (
    <CoverFallback
      src={coverUrl}
      name={track.title || track.artist || 'Track'}
      alt={alt}
      initialsClassName={initialsClassName}
    />
  );
}

/**
 * Horizontal inset (px) applied to the timeline thumb so it never
 * extends into the dock's rounded-corner zone. Mirrors the desktop
 * Player constant of the same name. The progress fill itself is
 * unchanged — it lives inside the clipped surface and is already
 * rounded along with it; the inset only matters for the standalone
 * thumb (which is rendered as a sibling of the clipped surface so its
 * top/bottom halves can sit outside the rail without being cropped).
 */
const RAIL_INSET_PX = 12;

const navItems: { to: string; icon: typeof Home; labelKey: TranslationKey }[] = [
  { to: '/', icon: Home, labelKey: 'nav.home' },
  { to: '/search', icon: Search, labelKey: 'nav.search' },
  { to: '/library', icon: Library, labelKey: 'nav.library' },
  { to: '/profile', icon: UserIcon, labelKey: 'nav.profile' },
];

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
  const t = useT();

  // Bar coordinate system matches the thumb: both inset by RAIL_INSET_PX
  // on each side so the bar's right edge lands exactly under the thumb's
  // centre. Without this the bar fills the full rail (0 → 100 %) but the
  // thumb only reaches `100 % − INSET` — visible as the timeline progress
  // outpacing the thumb on long tracks.
  const progressWidth = useTransform(
    [progressSeconds as MotionValue<number>, durationSeconds as MotionValue<number>],
    (values) => {
      const [pos, dur] = values as [number, number];
      const r = dur > 0 ? Math.min(1, Math.max(0, pos / dur)) : 0;
      return `calc((100% - ${RAIL_INSET_PX * 2}px) * ${r})`;
    },
  );
  // Thumb travels along the rail, but is rendered as a sibling of the
  // clipped surface (see Player.tsx) so its top/bottom halves can extend
  // beyond the 3 px rail without being cropped, and so the leftmost /
  // rightmost positions don't fall inside the rounded-corner zone.
  // `left` matches the desktop computation: rail-inset, then a fraction
  // of the remaining width.
  const thumbLeft = useTransform(
    [progressSeconds as MotionValue<number>, durationSeconds as MotionValue<number>],
    (values) => {
      const [pos, dur] = values as [number, number];
      const r = dur > 0 ? Math.min(1, Math.max(0, pos / dur)) : 0;
      return `calc(${RAIL_INSET_PX}px + (100% - ${RAIL_INSET_PX * 2}px) * ${r})`;
    },
  );

  // Mini-player timeline thumb visibility. The thumb is rendered as a
  // sibling of the clipped player surface so it can extend above the
  // dock's rounded top edge without being cut off — which means it
  // can't rely on `group-hover/progress` (its parent is no longer the
  // hit-area). We track hover and active drag explicitly instead.
  const [seekHover, setSeekHover] = useState(false);
  const [seekActive, setSeekActive] = useState(false);
  const thumbVisible = seekHover || seekActive;

  if (fullscreen) return null;
  const liked = currentTrack ? isLiked(currentTrack.id) : false;

  return (
    // Outer wrapper deliberately has NO overflow-hidden / NO rounded /
    // NO liquid-glass. It only positions the dock; the visual surface is
    // the child below, while the timeline thumb is rendered as a sibling
    // of the surface so it can poke above the dock's rounded top edge
    // without being clipped.
    <div
      className="fixed bottom-[calc(env(safe-area-inset-bottom,0px)+1rem)] left-4 right-4 z-40 sm:bottom-[calc(env(safe-area-inset-bottom,0px)+1.5rem)] sm:left-6 sm:right-6 lg:hidden"
    >
    <div
      className="flex flex-col overflow-hidden rounded-[var(--radius-xl)] liquid-glass"
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
              className="relative h-[3px] w-full shrink-0 cursor-pointer touch-none select-none overflow-hidden bg-white/[0.08]"
              role="slider"
              aria-label={t('player.seek')}
              aria-valuemin={0}
              aria-valuemax={Math.max(1, Math.round(duration))}
              aria-valuenow={Math.round(progress)}
              onPointerEnter={() => setSeekHover(true)}
              onPointerLeave={() => setSeekHover(false)}
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                const rect = e.currentTarget.getBoundingClientRect();
                const seekFromX = (clientX: number) => {
                  // Pointer-to-position mapping matches the bar+thumb
                  // inset coordinate system so the cursor is always
                  // exactly under the thumb when dragging — see
                  // Player.tsx for the full rationale.
                  const usable = Math.max(1, rect.width - RAIL_INSET_PX * 2);
                  const pct = Math.min(1, Math.max(0, (clientX - rect.left - RAIL_INSET_PX) / usable));
                  seekAudio(pct * duration);
                };
                seekFromX(e.clientX);
                setSeekActive(true);
                const target = e.currentTarget;
                const onMove = (ev: PointerEvent) => seekFromX(ev.clientX);
                const onUp = (ev: PointerEvent) => {
                  seekFromX(ev.clientX);
                  target.removeEventListener('pointermove', onMove);
                  target.removeEventListener('pointerup', onUp);
                  target.removeEventListener('pointercancel', onUp);
                  try { target.releasePointerCapture(ev.pointerId); } catch { /* ignore */ }
                  setSeekActive(false);
                };
                target.addEventListener('pointermove', onMove);
                target.addEventListener('pointerup', onUp);
                target.addEventListener('pointercancel', onUp);
              }}
            >
              <motion.div
                className="absolute inset-y-0 bg-gradient-to-r from-[var(--color-accent)] via-[var(--color-sub-accent)] to-[var(--color-accent)]"
                style={{ left: `${RAIL_INSET_PX}px`, width: progressWidth }}
              />
            </div>

            <div
              className="flex cursor-pointer items-center gap-3 px-3 py-2.5"
              role="button"
              tabIndex={0}
              aria-label={t('player.openPlayer')}
              onClick={(e) => {
                // Whole row opens fullscreen, except when the click lands on
                // an interactive control (cover/title also openFullscreen on
                // their own; artist/like/play/next handle their own actions
                // and the closest('button') guard prevents a second call).
                const target = e.target as HTMLElement | null;
                if (target?.closest('button, a')) return;
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
                {(track, position) => (
                  <div
                    className="flex w-full min-w-0 items-center gap-3"
                    style={{ opacity: position === 'current' ? 1 : 0.6 }}
                  >
                    <button
                      type="button"
                      onClick={position === 'current' ? openFullscreen : undefined}
                      aria-label={t('player.openPlayer')}
                      tabIndex={position === 'current' ? 0 : -1}
                      className="group relative h-11 w-11 shrink-0 overflow-hidden rounded-[var(--radius-sm)] border border-white/10"
                    >
                      <StripCover
                        track={track}
                        alt={track.title}
                        initialsClassName="text-[10px]"
                      />
                      {position === 'current' && (
                        <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
                          <Maximize2 size={14} className="text-white" />
                        </div>
                      )}
                    </button>
                    {/* Title/artist column. Hard-cap at `basis-0` so the
                        column derives its width entirely from the flex
                        machinery (free space after the fixed-width
                        cover/like/play/next buttons), never from the
                        intrinsic max-content of the title text. The
                        `min-w-0` + `overflow-hidden` chain stops the
                        Marquee child from contributing its own
                        max-content to the parent flex calculation. */}
                    <div className="min-w-0 flex-1 basis-0 overflow-hidden">
                      <button
                        type="button"
                        onClick={position === 'current' ? openFullscreen : undefined}
                        tabIndex={position === 'current' ? 0 : -1}
                        className="block w-full max-w-full min-w-0 overflow-hidden text-left text-sm font-medium leading-tight"
                        aria-label={t('player.openPlayer')}
                      >
                        <Marquee text={track.title} />
                      </button>
                      {position === 'current' && track.artists && track.artists.length > 1 ? (
                        <div className="block w-full overflow-hidden text-left text-xs text-muted-foreground">
                          <span className="block truncate">
                            <ArtistLinks
                              artists={track.artists}
                              fallbackName={track.artist}
                              fallbackId={track.artistId}
                              className="hover:text-foreground hover:underline"
                            />
                          </span>
                        </div>
                      ) : position === 'current' && track.artistId ? (
                        <button
                          type="button"
                          onClick={() => navigate(`/artist/${track.artistId}`)}
                          className="block w-full text-left text-xs text-muted-foreground transition-colors hover:text-foreground"
                          aria-label={t('player.openArtist', { name: track.artist })}
                        >
                          <Marquee text={track.artist} />
                        </button>
                      ) : (
                        <Marquee text={track.artist} className="text-xs text-muted-foreground" />
                      )}
                    </div>
                  </div>
                )}
              </SwipeTrackStrip>

              <button
                type="button"
                onClick={() => currentTrack && toggle(currentTrack)}
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-[transform,colors,background-color] active:scale-90 hover:bg-[var(--color-hover-overlay)] hover:text-foreground ${liked ? 'text-[var(--color-accent)]' : ''}`}
                aria-label={liked ? t('player.unlike') : t('player.like')}
              >
                <Heart size={16} fill={liked ? 'currentColor' : 'none'} />
              </button>

              <button
                type="button"
                onClick={togglePlay}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--color-accent)] text-[var(--color-text-on-accent)] shadow-[0_2px_8px_-2px_var(--color-accent-glow)] transition-[transform,box-shadow] active:scale-95 hover:shadow-[0_4px_16px_-4px_var(--color-accent-glow)]"
                aria-label={isPlaying ? t('player.pause') : t('player.play')}
              >
                {isPlaying ? <Pause size={16} fill="currentColor" strokeWidth={0} /> : <Play size={16} fill="currentColor" />}
              </button>

              <button
                type="button"
                onClick={nextManual}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-[transform,colors,background-color] active:scale-90 hover:bg-[var(--color-hover-overlay)] hover:text-foreground"
                aria-label={t('player.next')}
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
        {navItems.map(({ to, icon: Icon, labelKey }) => (
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
            {t(labelKey)}
          </NavLink>
        ))}
      </nav>
    </div>
    {/* Draggable thumb — rendered as a sibling of the clipped surface
        so its top half can extend above the dock's rounded top edge
        without being cropped by overflow-hidden, and so the leftmost /
        rightmost positions don't get clipped by the rounded-corner
        zone. Visibility is driven by the seekHover / seekActive flags;
        `top: 1px` centres the dot on the 3 px rail at the top of the
        surface (which itself is at top: 0 of this positioning
        wrapper). */}
    {currentTrack && (
      <motion.div
        aria-hidden
        className="pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--color-accent)] shadow-[0_0_0_2px_var(--color-bg)] transition-opacity duration-150"
        style={{ left: thumbLeft, top: '1px', opacity: thumbVisible ? 1 : 0 }}
      />
    )}
    </div>
  );
}
