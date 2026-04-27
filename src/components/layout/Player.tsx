import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Play, Pause, SkipBack, SkipForward,
  Volume2, VolumeX, Shuffle, Repeat, Repeat1, Maximize2, AlertTriangle, Heart,
  MoreHorizontal, ListPlus, ListOrdered, Share2, User as UserIcon, Check, Radio, Loader2,
  Download, Upload,
} from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion, useTransform } from 'motion/react';
import { usePlayerStore } from '@/store/player';
import { useAudioPlayer, usePlaybackVisuals } from '@/hooks/useAudioPlayer';
import { Button } from '@/components/ui/Button';
import { PopoverMenu } from '@/components/ui/PopoverMenu';
import { useToggleLike } from '@/hooks/useLibrary';
import { AddToPlaylistDialog } from '@/components/features/AddToPlaylistDialog';
import { QueueDialog } from '@/components/features/QueueDialog';
import { TrackOverrideModal } from '@/components/features/TrackOverrideModal';
import { startTrackRadio } from '@/lib/trackRadio';
import { downloadTrack } from '@/lib/trackActions';
import type { Track } from '@/types';

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

export function Player() {
  const {
    currentTrack, isPlaying, togglePlay, nextManual, previous,
    muted, toggleMute, volume, setVolume,
    shuffle, toggleShuffle, repeat, cycleRepeat,
    duration, error, openFullscreen,
  } = usePlayerStore();

  const { progress, seek } = useAudioPlayer();
  const { progressSeconds, bufferedSeconds, durationSeconds } = usePlaybackVisuals();
  // rAF-driven width for the played and buffered bars. Driving these via
  // MotionValues lets the bar slide at full frame rate without re-rendering
  // the player on every animation frame.
  const progressWidth = useTransform([progressSeconds, durationSeconds] as unknown as never, ([t, d]: [number, number]) =>
    d > 0 ? `${Math.min(100, (t / d) * 100)}%` : '0%');
  const bufferedWidth = useTransform([bufferedSeconds, durationSeconds] as unknown as never, ([b, d]: [number, number]) =>
    d > 0 ? `${Math.min(100, (b / d) * 100)}%` : '0%');
  const reduce = useReducedMotion();
  const { isLiked, toggle } = useToggleLike();
  const liked = currentTrack ? isLiked(currentTrack.id) : false;
  const navigate = useNavigate();

  const [menuOpen, setMenuOpen] = useState(false);
  const [addToPlaylistOpen, setAddToPlaylistOpen] = useState(false);
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
        window.prompt('Скопируйте ссылку:', url);
      } finally {
        document.body.removeChild(textarea);
      }
    }
    // Keep the menu open briefly so the "Ссылка скопирована" confirmation is visible.
    setTimeout(() => setMenuOpen(false), 900);
  };

  const handleGoToArtist = () => {
    if (!currentTrack?.artistId) return;
    setMenuOpen(false);
    navigate(`/artist/${currentTrack.artistId}`);
  };

  const [radioBusy, setRadioBusy] = useState(false);
  const [radioError, setRadioError] = useState<string | null>(null);
  const handleStartRadio = async () => {
    if (!currentTrack || radioBusy) return;
    setRadioBusy(true);
    setRadioError(null);
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
      setRadioError(err instanceof Error ? err.message : 'Не удалось запустить волну');
      window.setTimeout(() => setRadioError(null), 4000);
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
          className="player-desktop-grid fixed bottom-[calc(3.5rem+env(safe-area-inset-bottom,0px)+1rem)] left-4 right-4 z-30 flex flex-col overflow-hidden rounded-t-[var(--radius-xl)] rounded-b-none border-b-0 liquid-glass no-foot sm:bottom-[calc(3.5rem+env(safe-area-inset-bottom,0px)+1.5rem)] sm:left-6 sm:right-6 lg:bottom-10 lg:rounded-[var(--radius-xl)] lg:border-b"
          style={{ height: 'var(--player-height)' }}
        >
          {(error || radioError) && (
            <div className="flex items-center gap-2 bg-[var(--color-danger-muted)] px-4 py-1.5 text-xs text-[var(--color-danger)]">
              <AlertTriangle size={12} className="shrink-0" />
              <span className="truncate">{radioError || error}</span>
            </div>
          )}

          {/* Timeline: thin rail flush with the top edge of the player.
              The bar grows slightly on hover/active for affordance, but
              there is no extra wrapper above it (the user explicitly
              wanted the timeline's top edge to be the player's top
              edge). Hit area is the full bar height; we deliberately
              omit the thumb on the mini-player to keep the surface
              clean — the fullscreen player is where the draggable
              thumb lives. */}
          <div
            className="group/progress relative h-1 w-full shrink-0 cursor-pointer touch-none overflow-hidden bg-[var(--color-bg-muted)] transition-[height] duration-150 select-none hover:h-1.5 active:h-1.5"
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
            {/* Buffered range — a faint bar that runs from the start of
                the track to whatever the audio element reports as
                buffered. Sits visually behind the played bar so once
                playback catches up the gradient covers it. */}
            <motion.div
              className="absolute inset-y-0 left-0 bg-white/15"
              style={{ width: bufferedWidth }}
              aria-hidden
            />
            <motion.div
              className="absolute inset-y-0 left-0 bg-gradient-to-r from-[var(--color-accent)] via-[var(--color-sub-accent)] to-[var(--color-accent)]"
              style={{ width: progressWidth }}
            />
          </div>

          <div className="flex flex-1 items-center gap-3 px-3 sm:gap-4 sm:px-4">
            {/* Cover + title open the fullscreen player; the artist name is
                a separate inline link to the artist page so users can jump
                straight to the artist without going through the 3-dot menu. */}
            <div className="group flex min-w-0 flex-1 items-center gap-3">
              {currentTrack.coverUrl && (
                <motion.button
                  type="button"
                  onClick={openFullscreen}
                  aria-label="Открыть плеер"
                  className="relative h-11 w-11 shrink-0 overflow-hidden rounded-[var(--radius-sm)] border border-border"
                  initial={reduce ? false : { scale: 0.8, opacity: 0 }}
                  animate={reduce ? undefined : { scale: 1, opacity: 1 }}
                  key={currentTrack.id}
                >
                  <img src={currentTrack.coverUrl} alt={currentTrack.title} className="h-full w-full object-cover" />
                  <div className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 transition-opacity group-hover:opacity-100">
                    <Maximize2 size={14} className="text-white" />
                  </div>
                </motion.button>
              )}
              <div className="min-w-0">
                <button
                  type="button"
                  onClick={openFullscreen}
                  className="block w-full truncate text-left text-sm font-medium transition-opacity hover:opacity-90"
                  aria-label="Открыть плеер"
                >
                  {currentTrack.title}
                </button>
                {currentTrack.artistId ? (
                  <button
                    type="button"
                    onClick={() => navigate(`/artist/${currentTrack.artistId}`)}
                    className="block w-full truncate text-left text-xs text-muted-foreground transition-colors hover:text-foreground hover:underline-offset-4"
                    aria-label={`Открыть артиста ${currentTrack.artist}`}
                  >
                    {currentTrack.artist}
                  </button>
                ) : (
                  <p className="truncate text-xs text-muted-foreground">{currentTrack.artist}</p>
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
                aria-label={liked ? 'Убрать лайк' : 'Лайк'}
                className={liked ? 'text-[var(--color-accent)]' : ''}
              >
                <Heart size={16} fill={liked ? 'currentColor' : 'none'} />
              </Button>
            </motion.div>

            <div className="flex items-center gap-1">
              <Button onClick={toggleShuffle} variant="ghost" size="icon" className="hidden md:inline-flex" aria-label="Перемешать">
                <Shuffle size={15} className={shuffle ? 'text-[var(--color-accent)]' : 'text-muted-foreground'} />
              </Button>
              <Button onClick={previous} variant="ghost" size="icon" aria-label="Предыдущий">
                <SkipBack size={16} />
              </Button>
              <motion.div whileTap={reduce ? undefined : { scale: 0.92 }}>
                <Button onClick={togglePlay} size="icon" className="h-10 w-10" aria-label={isPlaying ? 'Пауза' : 'Пуск'}>
                  {isPlaying ? <Pause size={16} fill="currentColor" strokeWidth={0} /> : <Play size={16} fill="currentColor" />}
                </Button>
              </motion.div>
              <Button onClick={nextManual} variant="ghost" size="icon" aria-label="Следующий">
                <SkipForward size={16} />
              </Button>
              <Button onClick={cycleRepeat} variant="ghost" size="icon" className="hidden md:inline-flex" aria-label="Повтор">
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
                aria-label="Действия с треком"
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
                      {/* Shuffle + repeat — surfaced inside the kebab on
                          narrow widths where the inline buttons are
                          hidden. md+ keeps them as the dedicated icon
                          buttons in the player row instead. Re-using the
                          same store actions so their state stays in
                          sync with the inline buttons. */}
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => { toggleShuffle(); }}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-secondary md:hidden"
                      >
                        <Shuffle size={14} className={shuffle ? 'text-[var(--color-accent)]' : ''} />
                        {shuffle ? 'Перемешать: вкл' : 'Перемешать'}
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => { cycleRepeat(); }}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-secondary md:hidden"
                      >
                        {repeat === 'one' ? (
                          <Repeat1 size={14} className="text-[var(--color-accent)]" />
                        ) : (
                          <Repeat size={14} className={repeat === 'all' ? 'text-[var(--color-accent)]' : ''} />
                        )}
                        Повтор: {repeat === 'off' ? 'выкл' : repeat === 'all' ? 'очередь' : 'один трек'}
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => { setQueueOpen(true); setMenuOpen(false); }}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-secondary"
                      >
                        <ListOrdered size={14} />
                        Очередь
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => { setAddToPlaylistOpen(true); setMenuOpen(false); }}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-secondary"
                      >
                        <ListPlus size={14} />
                        Добавить в плейлист
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={handleStartRadio}
                        disabled={radioBusy}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-secondary disabled:opacity-60"
                      >
                        {radioBusy ? <Loader2 size={14} className="animate-spin" /> : <Radio size={14} />}
                        Запустить волну
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => { handleDownload(); setMenuOpen(false); }}
                        disabled={downloading}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-secondary disabled:opacity-60"
                      >
                        {downloading ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                        Скачать
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => { setOverrideOpen(true); setMenuOpen(false); }}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-secondary"
                      >
                        <Upload size={14} />
                        Загрузить свою версию
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={handleShare}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-secondary"
                      >
                        {shareCopied ? <Check size={14} className="text-[var(--color-accent)]" /> : <Share2 size={14} />}
                        {shareCopied ? 'Ссылка скопирована' : 'Поделиться'}
                      </button>
                      {currentTrack.artistId && (
                        <button
                          type="button"
                          role="menuitem"
                          onClick={handleGoToArtist}
                          className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-secondary"
                        >
                          <UserIcon size={14} />
                          Перейти к артисту
                        </button>
                )}
              </PopoverMenu>
            </div>

            <div className="hidden flex-1 items-center justify-end gap-2 md:flex">
              <span className="text-xs text-muted-foreground">
                {formatTime(progress)} / {formatTime(duration)}
              </span>
              <Button onClick={toggleMute} variant="ghost" size="icon" className="h-9 w-9" aria-label="Звук">
                {muted ? <VolumeX size={15} /> : <Volume2 size={15} />}
              </Button>
              {/* Custom volume slider — same thickness/visuals as the
                  progress bar (h-1 default, h-1.5 on hover/drag). Native
                  <input type=range> couldn't match the rail height
                  reliably across browsers. */}
              <div
                className="group/volume relative flex h-6 w-24 cursor-pointer touch-none items-center select-none"
                role="slider"
                aria-label="Громкость"
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
                <div className="relative h-1 w-full overflow-hidden rounded-full bg-[var(--color-bg-muted)] transition-[height] duration-150 group-hover/volume:h-1.5 group-active/volume:h-1.5">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-[var(--color-accent)] via-[var(--color-sub-accent)] to-[var(--color-accent)] transition-[width] duration-100"
                    style={{ width: `${(muted ? 0 : volume) * 100}%` }}
                  />
                </div>
                <div
                  className="pointer-events-none absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--color-accent)] shadow-[0_0_0_2px_var(--color-bg)] opacity-0 transition-opacity group-hover/volume:opacity-100 group-active/volume:opacity-100"
                  style={{ left: `${(muted ? 0 : volume) * 100}%` }}
                />
              </div>
              <Button onClick={openFullscreen} variant="ghost" size="icon" aria-label="Развернуть">
                <Maximize2 size={15} />
              </Button>
            </div>
          </div>

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
