import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Play, Pause, SkipBack, SkipForward,
  Volume2, VolumeX, Shuffle, Repeat, Repeat1, Maximize2, Heart,
  MoreHorizontal, ListPlus, ListOrdered, Share2, User as UserIcon, Check, Radio, Loader2,
  Download, Upload, Disc, Ban, RotateCcw,
} from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion, useTransform } from 'motion/react';
import { usePlayerStore } from '@/store/player';
import { useAudioPlayer, usePlaybackVisuals } from '@/hooks/useAudioPlayer';
import { Button } from '@/components/ui/Button';
import { PopoverMenu, MenuItem, MenuDivider } from '@/components/ui/PopoverMenu';
import { Marquee } from '@/components/ui/Marquee';
import { CoverFallback } from '@/components/ui/CoverFallback';
import { useToggleLike } from '@/hooks/useLibrary';
import { useDislikesStore } from '@/store/dislikes';
import { useToggleDislike } from '@/hooks/useDislikes';
import { useAuthStore } from '@/store/auth';
import { AddToPlaylistDialog } from '@/components/features/AddToPlaylistDialog';
import { QueueDialog } from '@/components/features/QueueDialog';
import { TrackOverrideModal } from '@/components/features/TrackOverrideModal';
import { startTrackRadio } from '@/lib/trackRadio';
import { downloadTrack } from '@/lib/trackActions';
import { ArtistLinks } from '@/components/features/ArtistLinks';
import type { Track } from '@/types';
import { useT } from '@/i18n';
import { toast } from '@/store/toast';

function formatTime(seconds: number): string {
  if (!seconds || !isFinite(seconds)) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function buildShareUrl(trackId: string): string {
  const url = new URL(window.location.href);
  // Strip any hash-router prefix if present.
  const base = `${url.origin}${url.pathname.replace(/\/?(track|search|playlist|album|artist|profile|admin)\/.*$/, '')}`.replace(/\/$/, '');
  return `${base}/track/${trackId}?autoplay=1`;
}

/**
 * Horizontal inset (px) applied to the timeline rail and thumb so they
 * never extend into the player surface's rounded-corner zone. Roughly
 * matches the corner radius (`--radius-xl` = 20px) but slightly
 * smaller — the bar fill underneath is already clipped by the surface,
 * so visually nothing changes; this just keeps the thumb away from the
 * bezel where it would otherwise appear to float on transparent space.
 */
const RAIL_INSET_PX = 14;

export function Player() {
  const t = useT();
  const {
    currentTrack, isPlaying, togglePlay, nextManual, previous,
    muted, toggleMute, volume, setVolume,
    shuffle, toggleShuffle, repeat, cycleRepeat,
    duration, openFullscreen,
  } = usePlayerStore();

  const { progress, seek } = useAudioPlayer();
  const { progressSeconds, bufferedSeconds, durationSeconds } = usePlaybackVisuals();
  // rAF-driven geometry for the played, buffered bars and the thumb.
  // All three derive from the SAME inset coordinate system so the bar's
  // visual right-edge always coincides with the thumb's centre — the
  // user reported "ползунок таймлайна, особенно на длинных треках
  // визуально обгоняет thumb", which was the bar (no inset) racing
  // ahead of the thumb (inset by RAIL_INSET_PX on both sides) at the
  // far end of long tracks. By computing both the bar's left+width and
  // the thumb's left from the same `INSET + (100% - 2*INSET) * r`
  // formula they now stay perfectly aligned.
  const progressWidth = useTransform([progressSeconds, durationSeconds] as unknown as never, ([t, d]: [number, number]) => {
    const r = d > 0 ? Math.min(1, Math.max(0, t / d)) : 0;
    return `calc((100% - ${RAIL_INSET_PX * 2}px) * ${r})`;
  });
  const bufferedWidth = useTransform([bufferedSeconds, durationSeconds] as unknown as never, ([buf, d]: [number, number]) => {
    const r = d > 0 ? Math.min(1, Math.max(0, buf / d)) : 0;
    return `calc((100% - ${RAIL_INSET_PX * 2}px) * ${r})`;
  });
  // Thumb sits at the right edge of the played fill: same coordinate
  // system, same value of `r`.
  const thumbLeft = useTransform([progressSeconds, durationSeconds] as unknown as never, ([t, d]: [number, number]) => {
    const r = d > 0 ? Math.min(1, Math.max(0, t / d)) : 0;
    return `calc(${RAIL_INSET_PX}px + (100% - ${RAIL_INSET_PX * 2}px) * ${r})`;
  });
  const reduce = useReducedMotion();
  const { isLiked, toggle } = useToggleLike();
  const liked = currentTrack ? isLiked(currentTrack.id) : false;
  const navigate = useNavigate();
  const isAuthed = useAuthStore((s) => Boolean(s.user));
  const trackDisliked = useDislikesStore((s) => Boolean(currentTrack && s.tracks.has(currentTrack.id)));
  const artistDisliked = useDislikesStore((s) => Boolean(currentTrack?.artistId && s.artists.has(currentTrack.artistId)));
  const toggleDislike = useToggleDislike();

  const [menuOpen, setMenuOpen] = useState(false);
  const [addToPlaylistOpen, setAddToPlaylistOpen] = useState(false);
  // Mini-player timeline thumb visibility. The thumb is rendered as a
  // sibling of the clipped player surface so it can extend above the
  // player's rounded top edge without being cut off — which means it
  // can't rely on `group-hover/progress` (its parent is no longer the
  // hit-area). We track hover and active drag explicitly instead.
  const [seekHover, setSeekHover] = useState(false);
  const [seekActive, setSeekActive] = useState(false);
  const thumbVisible = seekHover || seekActive;
  const [queueOpen, setQueueOpen] = useState(false);
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);

  const handleDownload = async () => {
    if (!currentTrack || downloading) return;
    setDownloading(true);
    try {
      await downloadTrack(currentTrack);
    } catch (err) {
      console.error('[download]', err);
    } finally {
      setDownloading(false);
    }
  };
  // Menu trigger ref — used by PopoverMenu to anchor the dropdown. Outside
  // clicks and Escape are handled inside PopoverMenu so we don't duplicate
  // them here.
  const menuTriggerRef = useRef<HTMLButtonElement>(null);



  const handleShare = async () => {
    if (!currentTrack) return;
    const url = buildShareUrl(currentTrack.id);
    try {
      await navigator.clipboard.writeText(url);
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 1500);
    } catch {
      // Clipboard API unavailable (insecure context, permissions denied, …).
      // Fall back to a textarea+execCommand copy before resorting to a prompt.
      const textarea = document.createElement('textarea');
      textarea.value = url;
      textarea.setAttribute('readonly', '');
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      try {
        document.execCommand('copy');
        setShareCopied(true);
        setTimeout(() => setShareCopied(false), 1500);
      } catch {
        window.prompt(t('track.copyPrompt'), url);
      } finally {
        document.body.removeChild(textarea);
      }
    }
    // Keep the menu open briefly so the "Ссылка скопирована" confirmation is visible.
    setTimeout(() => setMenuOpen(false), 900);
  };

  const handleGoToAlbum = () => {
    if (!currentTrack?.albumId) return;
    setMenuOpen(false);
    navigate(`/album/${currentTrack.albumId}`);
  };

  const handleToggleTrackDislike = () => {
    if (!currentTrack) return;
    const wasDisliked = trackDisliked;
    toggleDislike.mutate(
      { kind: 'track', id: currentTrack.id, source: currentTrack.source ?? 'tidal', nextState: wasDisliked ? 'unbanned' : 'banned' },
      {
        onSuccess: () => {
          toast.info(wasDisliked ? t('dislike.trackRestored') : t('dislike.trackHidden', { title: currentTrack.title }));
        },
        onError: (err) => toast.error(err instanceof Error ? err.message : t('dislike.failed')),
      },
    );
    setMenuOpen(false);
  };

  const handleToggleArtistDislike = () => {
    if (!currentTrack?.artistId) return;
    const wasDisliked = artistDisliked;
    toggleDislike.mutate(
      { kind: 'artist', id: currentTrack.artistId, source: currentTrack.source ?? 'tidal', nextState: wasDisliked ? 'unbanned' : 'banned' },
      {
        onSuccess: () => {
          toast.info(wasDisliked ? t('dislike.artistRestored') : t('dislike.artistHidden', { name: currentTrack.artist }));
        },
        onError: (err) => toast.error(err instanceof Error ? err.message : t('dislike.failed')),
      },
    );
    setMenuOpen(false);
  };

  const handleGoToArtist = () => {
    if (!currentTrack?.artistId) return;
    setMenuOpen(false);
    navigate(`/artist/${currentTrack.artistId}`);
  };

  const [radioBusy, setRadioBusy] = useState(false);
  const handleStartRadio = async () => {
    if (!currentTrack || radioBusy) return;
    setRadioBusy(true);
    try {
      const seed: Track = {
        id: currentTrack.id,
        title: currentTrack.title,
        artist: currentTrack.artist,
        artistId: currentTrack.artistId ?? '',
        album: '',
        albumId: '',
        duration: duration || 0,
        coverUrl: currentTrack.coverUrl,
      };
      await startTrackRadio(seed);
      setMenuOpen(false);
    } catch (err) {
      // Routed through the global toast surface — no more inline
      // banner stuffed into the player chrome.
      toast.error(err instanceof Error ? err.message : t('player.radioFailed'));
    } finally {
      setRadioBusy(false);
    }
  };

  return (
    <AnimatePresence>
      {currentTrack && (
        <motion.div
          key="player"
          initial={reduce ? false : { y: 80, opacity: 0 }}
          animate={reduce ? undefined : { y: 0, opacity: 1 }}
          exit={reduce ? undefined : { y: 80, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 280, damping: 30 }}
          // Outer wrapper deliberately has NO overflow-hidden / NO rounded /
          // NO liquid-glass. It only positions the player and runs the
          // y/opacity animation. The visual surface is a child div, while
          // the timeline thumb is rendered as a sibling so it can poke
          // above the player's rounded top edge without being clipped.
          className="player-desktop-grid fixed bottom-10 left-4 right-4 z-30 hidden sm:left-6 sm:right-6 lg:block"
          style={{ height: 'var(--player-height)' }}
        >
          {/* Visible surface — clipped + rounded + liquid-glass. Holds the
              thin rail timeline (h-1 / h-1.5 on hover) flush with the top
              edge as before, and the main mini-player row. Errors used to
              live as an inline banner up here; they now fly into the
              global ToastHost in the top-left corner so playback chrome
              stays stable as the audio engine retries / falls back. */}
          <div className="absolute inset-0 flex flex-col overflow-hidden rounded-[var(--radius-xl)] liquid-glass">

            {/* Timeline rail (and its full-width hit area). Identical to
                the historical mini-player: a 1 px bar flush with the top
                edge, growing to 1.5 px on hover/active. The rail itself
                lives inside the clipped surface so the buffered/played
                gradients respect the rounded top corners. The draggable
                thumb is NOT inside this hit-area anymore — it's a sibling
                of the surface (see below) so it can extend above the
                rail without being clipped. */}
            <div
              className="relative w-full shrink-0 cursor-pointer touch-none select-none overflow-hidden bg-[var(--color-bg-muted)]"
              style={{ height: '4px' }}
              onPointerEnter={() => setSeekHover(true)}
              onPointerLeave={() => setSeekHover(false)}
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                const rect = e.currentTarget.getBoundingClientRect();
                const seekFromX = (clientX: number) => {
                  // Match the bar/thumb coordinate system: both are
                  // inset by RAIL_INSET_PX on each side, so the
                  // pointer's mapping to playback position has to be
                  // computed against the inset range, not the full
                  // rail width. Without this the thumb visually lags
                  // the cursor by INSET pixels at the very right end
                  // of the rail (and a corresponding amount when
                  // dragged near the left), which is what the user
                  // saw as "когда тянешь ползунок рассинхрон случается
                  // тем больше чем ближе к концу ведешь ... в начале
                  // его нет, но когда ведешь в конец то появляется
                  // рассинхрон между курсором и thumb".
                  const usable = Math.max(1, rect.width - RAIL_INSET_PX * 2);
                  const pct = Math.min(1, Math.max(0, (clientX - rect.left - RAIL_INSET_PX) / usable));
                  seek(pct * duration);
                };
                seekFromX(e.clientX);
                setSeekActive(true);
                const target = e.currentTarget;
                const onMove = (ev: PointerEvent) => seekFromX(ev.clientX);
                const finish = (ev: PointerEvent) => {
                  seekFromX(ev.clientX);
                  target.removeEventListener('pointermove', onMove);
                  target.removeEventListener('pointerup', finish);
                  target.removeEventListener('pointercancel', finish);
                  try { target.releasePointerCapture(ev.pointerId); } catch { /* ignore */ }
                  setSeekActive(false);
                };
                target.addEventListener('pointermove', onMove);
                target.addEventListener('pointerup', finish);
                target.addEventListener('pointercancel', finish);
              }}
            >
              {/* Buffered range — a faint bar that runs from the start of
                  the track to whatever the audio element reports as
                  buffered. Sits visually behind the played bar so once
                  playback catches up the gradient covers it. */}
              <motion.div
                className="absolute inset-y-0 bg-white/15"
                style={{ left: `${RAIL_INSET_PX}px`, width: bufferedWidth }}
                aria-hidden
              />
              <motion.div
                className="absolute inset-y-0 bg-gradient-to-r from-[var(--color-accent)] via-[var(--color-sub-accent)] to-[var(--color-accent)]"
                style={{ left: `${RAIL_INSET_PX}px`, width: progressWidth }}
              />
            </div>

          <div
            className="flex flex-1 cursor-pointer items-center gap-3 px-3 sm:gap-4 sm:px-4"
            role="button"
            tabIndex={0}
            aria-label={t('player.openPlayer')}
            onClick={(e) => {
              // Click anywhere on the mini-player background opens fullscreen.
              // Inner buttons (cover/title also call openFullscreen on their
              // own; artist/like/transport/menu/volume each handle their own
              // action) are detected via closest('button, a, input') and
              // skipped to avoid swallowing their clicks.
              const target = e.target as HTMLElement | null;
              if (target?.closest('button, a, input, [role="slider"]')) return;
              openFullscreen();
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                openFullscreen();
              }
            }}
          >
            {/* Cover + title open the fullscreen player; the artist name is
                a separate inline link to the artist page so users can jump
                straight to the artist without going through the 3-dot menu. */}
            <div className="group flex min-w-0 flex-1 items-center gap-3">
              <motion.button
                type="button"
                onClick={openFullscreen}
                aria-label={t('player.openPlayer')}
                className="relative h-11 w-11 shrink-0 overflow-hidden rounded-[var(--radius-sm)] border border-border"
                initial={reduce ? false : { scale: 0.8, opacity: 0 }}
                animate={reduce ? undefined : { scale: 1, opacity: 1 }}
                key={currentTrack.id}
              >
                <CoverFallback
                  src={currentTrack.coverUrl}
                  name={currentTrack.title || currentTrack.artist || 'Track'}
                  alt={currentTrack.title}
                  initialsClassName="text-[10px]"
                />
                <div className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 transition-opacity group-hover:opacity-100">
                  <Maximize2 size={14} className="text-white" />
                </div>
              </motion.button>
              <div className="min-w-0 flex-1">
                <button
                  type="button"
                  onClick={openFullscreen}
                  className="block w-full text-left text-sm font-medium transition-opacity hover:opacity-90"
                  aria-label={t('player.openPlayer')}
                >
                  <Marquee text={currentTrack.title} />
                </button>
                {currentTrack.artists && currentTrack.artists.length > 1 ? (
                  <div className="block w-full overflow-hidden text-xs text-muted-foreground">
                    <span className="block truncate">
                      <ArtistLinks
                        artists={currentTrack.artists}
                        fallbackName={currentTrack.artist}
                        fallbackId={currentTrack.artistId}
                        className="hover:text-foreground hover:underline"
                      />
                    </span>
                  </div>
                ) : currentTrack.artistId ? (
                  <button
                    type="button"
                    onClick={() => navigate(`/artist/${currentTrack.artistId}`)}
                    className="block w-full text-left text-xs text-muted-foreground transition-colors hover:text-foreground hover:underline-offset-4"
                    aria-label={t('player.openArtist', { name: currentTrack.artist })}
                  >
                    <Marquee text={currentTrack.artist} />
                  </button>
                ) : (
                  <Marquee text={currentTrack.artist} className="text-xs text-muted-foreground" />
                )}
              </div>
            </div>

            {/* Like sits next to track info on the left, easy thumb reach
              * on mobile. Replaces the previous central heart slot. */}
            <motion.div whileTap={reduce ? undefined : { scale: 0.85 }} className="shrink-0">
              <Button
                onClick={() => currentTrack && toggle(currentTrack)}
                variant="ghost"
                size="icon"
                aria-label={liked ? t('player.unlike') : t('player.like')}
                className={liked ? 'text-[var(--color-accent)]' : ''}
              >
                <Heart size={16} fill={liked ? 'currentColor' : 'none'} />
              </Button>
            </motion.div>

            <div className="flex items-center gap-1">
              <Button onClick={toggleShuffle} variant="ghost" size="icon" className="hidden md:inline-flex" aria-label={t('player.shuffle')}>
                <Shuffle size={15} className={shuffle ? 'text-[var(--color-accent)]' : 'text-muted-foreground'} />
              </Button>
              <Button onClick={previous} variant="ghost" size="icon" aria-label={t('player.previous')}>
                <SkipBack size={16} />
              </Button>
              <motion.div whileTap={reduce ? undefined : { scale: 0.92 }}>
                <Button onClick={togglePlay} size="icon" className="h-10 w-10 rounded-full" aria-label={isPlaying ? t('player.pause') : t('player.play')}>
                  {isPlaying ? <Pause size={16} fill="currentColor" strokeWidth={0} /> : <Play size={16} fill="currentColor" />}
                </Button>
              </motion.div>
              <Button onClick={nextManual} variant="ghost" size="icon" aria-label={t('player.next')}>
                <SkipForward size={16} />
              </Button>
              <Button onClick={cycleRepeat} variant="ghost" size="icon" className="hidden md:inline-flex" aria-label={t('player.repeat')}>
                {repeat === 'one' ? (
                  <Repeat1 size={15} className="text-[var(--color-accent)]" />
                ) : (
                  <Repeat size={15} className={repeat === 'all' ? 'text-[var(--color-accent)]' : 'text-muted-foreground'} />
                )}
              </Button>

              {/* 3-dot menu: add-to-playlist / share / artist. The actual menu
                * is rendered via PopoverMenu (body-level portal + fixed
                * position) so it can never reflow the player's flex row when
                * it opens. */}
              <Button
                ref={menuTriggerRef}
                variant="ghost"
                size="icon"
                onClick={() => setMenuOpen((v) => !v)}
                aria-label={t('track.actions')}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
              >
                <MoreHorizontal size={16} />
              </Button>
              <PopoverMenu
                open={menuOpen}
                onClose={() => setMenuOpen(false)}
                triggerRef={menuTriggerRef}
                anchor="top"
                align="end"
                width={224}
              >
                {/* Shuffle + repeat — surfaced inside the kebab on narrow
                    widths where the inline buttons are hidden. md+ keeps
                    them as the dedicated icon buttons in the player row
                    instead. Re-using the same store actions so their
                    state stays in sync with the inline buttons. */}
                <MenuItem
                  mobileOnly
                  onClick={() => { toggleShuffle(); }}
                  icon={<Shuffle size={14} className={shuffle ? 'text-[var(--color-accent)]' : ''} />}
                >
                  {shuffle ? t('player.shuffleOn') : t('player.shuffle')}
                </MenuItem>
                <MenuItem
                  mobileOnly
                  onClick={() => { cycleRepeat(); }}
                  icon={repeat === 'one' ? (
                    <Repeat1 size={14} className="text-[var(--color-accent)]" />
                  ) : (
                    <Repeat size={14} className={repeat === 'all' ? 'text-[var(--color-accent)]' : ''} />
                  )}
                >
                  {t('player.repeatStatus', { value: repeat === 'off' ? t('player.repeatOff') : repeat === 'all' ? t('player.repeatAll') : t('player.repeatOne') })}
                </MenuItem>
                <MenuItem
                  onClick={() => { setQueueOpen(true); setMenuOpen(false); }}
                  icon={<ListOrdered size={14} />}
                >
                  {t('player.queue')}
                </MenuItem>
                <MenuItem
                  onClick={() => { setAddToPlaylistOpen(true); setMenuOpen(false); }}
                  icon={<ListPlus size={14} />}
                >
                  {t('track.addToPlaylist')}
                </MenuItem>
                <MenuItem
                  onClick={handleStartRadio}
                  disabled={radioBusy}
                  icon={radioBusy ? <Loader2 size={14} className="animate-spin" /> : <Radio size={14} />}
                >
                  {t('track.startRadio')}
                </MenuItem>
                <MenuItem
                  onClick={() => { handleDownload(); setMenuOpen(false); }}
                  disabled={downloading}
                  icon={downloading ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                >
                  {t('track.download')}
                </MenuItem>
                <MenuItem
                  onClick={() => { setOverrideOpen(true); setMenuOpen(false); }}
                  icon={<Upload size={14} />}
                >
                  {t('track.uploadOwn')}
                </MenuItem>
                <MenuItem
                  onClick={handleShare}
                  icon={shareCopied ? <Check size={14} className="text-[var(--color-accent)]" /> : <Share2 size={14} />}
                >
                  {shareCopied ? t('track.shareCopied') : t('track.share')}
                </MenuItem>
                {currentTrack.artistId && (
                  <MenuItem
                    onClick={handleGoToArtist}
                    icon={<UserIcon size={14} />}
                  >
                    {t('track.goToArtist')}
                  </MenuItem>
                )}
                {currentTrack.albumId && (
                  <MenuItem
                    onClick={handleGoToAlbum}
                    icon={<Disc size={14} />}
                  >
                    {t('track.goToAlbum')}
                  </MenuItem>
                )}
                {isAuthed && (
                  <>
                    <MenuDivider />
                    <MenuItem
                      onClick={handleToggleTrackDislike}
                      disabled={toggleDislike.isPending}
                      icon={trackDisliked ? <RotateCcw size={14} /> : <Ban size={14} />}
                    >
                      {trackDisliked ? t('dislike.trackUnban') : t('dislike.trackBan')}
                    </MenuItem>
                    {currentTrack.artistId && (
                      <MenuItem
                        onClick={handleToggleArtistDislike}
                        disabled={toggleDislike.isPending}
                        icon={artistDisliked ? <RotateCcw size={14} /> : <Ban size={14} />}
                      >
                        {artistDisliked
                          ? t('dislike.artistUnban', { name: currentTrack.artist })
                          : t('dislike.artistBan', { name: currentTrack.artist })}
                      </MenuItem>
                    )}
                  </>
                )}
              </PopoverMenu>
            </div>

            <div className="hidden flex-1 items-center justify-end gap-2 md:flex">
              <span className="text-xs text-muted-foreground">
                {formatTime(progress)} / {formatTime(duration)}
              </span>
              <Button onClick={toggleMute} variant="ghost" size="icon" className="h-9 w-9" aria-label={t('player.mute')}>
                {muted ? <VolumeX size={15} /> : <Volume2 size={15} />}
              </Button>
              {/* Custom volume slider — same thickness/visuals as the
                  progress bar (h-1 default, h-1.5 on hover/drag). Native
                  <input type=range> couldn't match the rail height
                  reliably across browsers. */}
              <div
                className="group/volume relative flex h-6 w-24 cursor-pointer touch-none items-center select-none"
                role="slider"
                aria-label={t('player.volume')}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round((muted ? 0 : volume) * 100)}
                onPointerDown={(e) => {
                  e.currentTarget.setPointerCapture(e.pointerId);
                  const rect = e.currentTarget.getBoundingClientRect();
                  const setFromX = (clientX: number) => {
                    const pct = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
                    setVolume(pct);
                  };
                  setFromX(e.clientX);
                  const target = e.currentTarget;
                  const onMove = (ev: PointerEvent) => setFromX(ev.clientX);
                  const onUp = (ev: PointerEvent) => {
                    setFromX(ev.clientX);
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
                <div className="relative h-1 w-full overflow-hidden rounded-full bg-[var(--color-bg-muted)]">
                  {/* No CSS transition on width here — the fill MUST track
                      the cursor in the same frame as the pointermove event
                      that updates `volume`. The previous
                      `transition-[width] duration-100` made the bar trail
                      the cursor by ~100ms during drag, which read as the
                      slider being "laggy". */}
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-[var(--color-accent)] via-[var(--color-sub-accent)] to-[var(--color-accent)]"
                    style={{ width: `${(muted ? 0 : volume) * 100}%` }}
                  />
                </div>
                <div
                  className="pointer-events-none absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--color-accent)] shadow-[0_0_0_2px_var(--color-bg)] opacity-0 transition-opacity group-hover/volume:opacity-100 group-active/volume:opacity-100"
                  style={{ left: `${(muted ? 0 : volume) * 100}%` }}
                />
              </div>
              <Button onClick={openFullscreen} variant="ghost" size="icon" aria-label={t('player.expand')}>
                <Maximize2 size={15} />
              </Button>
            </div>
          </div>
          </div>
          {/* Draggable thumb — rendered as a sibling of the clipped surface
              so its top half can extend above the player's rounded top
              edge without being cropped by overflow-hidden. Visibility is
              driven by the seekHover / seekActive flags. Centred on the
              rail's vertical centre via `top: 2px` (= half of the 4px rail).
              `left` is calc'd against the same inset as the rail so the
              thumb never sits on top of the rounded bezel corners. */}
          <motion.div
            aria-hidden
            className="pointer-events-none absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--color-accent)] shadow-[0_0_0_2px_var(--color-bg)] transition-opacity duration-150"
            style={{ left: thumbLeft, top: '2px', opacity: thumbVisible ? 1 : 0 }}
          />
        </motion.div>
      )}

      {/* Dialogs must be outside the player's motion.div because its
        * backdrop-filter (glass class) creates a containing block for
        * fixed-positioned children — making the dialogs position
        * relative to the player bar instead of the viewport. */}
      {currentTrack && (
        <AddToPlaylistDialog
          track={currentTrack}
          open={addToPlaylistOpen}
          onClose={() => setAddToPlaylistOpen(false)}
        />
      )}
      <QueueDialog open={queueOpen} onClose={() => setQueueOpen(false)} />
      {currentTrack && (
        <TrackOverrideModal
          open={overrideOpen}
          onClose={() => setOverrideOpen(false)}
          trackId={currentTrack.id}
          trackTitle={`${currentTrack.artist} — ${currentTrack.title}`}
        />
      )}
    </AnimatePresence>
  );
}
