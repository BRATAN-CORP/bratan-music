import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Play, Pause, SkipBack, SkipForward,
  Volume2, VolumeX, Shuffle, Repeat, Repeat1, Maximize2, AlertTriangle, Heart,
  MoreHorizontal, ListPlus, Share2, User as UserIcon, Check,
} from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { usePlayerStore } from '@/store/player';
import { useAudioPlayer } from '@/hooks/useAudioPlayer';
import { Button } from '@/components/ui/Button';
import { useToggleLike } from '@/hooks/useLibrary';
import { AddToPlaylistDialog } from '@/components/features/AddToPlaylistDialog';

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
    currentTrack, isPlaying, togglePlay, next, previous,
    muted, toggleMute, volume, setVolume,
    shuffle, toggleShuffle, repeat, cycleRepeat,
    duration, error, openFullscreen,
  } = usePlayerStore();

  const { progress, seek } = useAudioPlayer();
  const reduce = useReducedMotion();
  const { isLiked, toggle } = useToggleLike();
  const liked = currentTrack ? isLiked(currentTrack.id) : false;
  const navigate = useNavigate();

  const [menuOpen, setMenuOpen] = useState(false);
  const [addToPlaylistOpen, setAddToPlaylistOpen] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [menuOpen]);

  const progressPct = duration > 0 ? (progress / duration) * 100 : 0;

  const handleShare = async () => {
    if (!currentTrack) return;
    const url = buildShareUrl(currentTrack.id);
    const shareData = {
      title: currentTrack.title,
      text: `${currentTrack.artist} — ${currentTrack.title}`,
      url,
    };
    if (typeof navigator.share === 'function' && navigator.canShare?.(shareData)) {
      try {
        await navigator.share(shareData);
        setMenuOpen(false);
        return;
      } catch {
        // user cancelled or share failed → fall through to clipboard
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 1500);
    } catch {
      // clipboard might be blocked — last-ditch fallback
      window.prompt('Скопируйте ссылку:', url);
    }
    setMenuOpen(false);
  };

  const handleGoToArtist = () => {
    if (!currentTrack?.artistId) return;
    setMenuOpen(false);
    navigate(`/artist/${currentTrack.artistId}`);
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
          className="fixed bottom-[calc(3.5rem+env(safe-area-inset-bottom,0px))] left-0 right-0 z-30 flex flex-col border-t border-border glass lg:bottom-0 lg:left-60"
          style={{ height: 'var(--player-height)' }}
        >
          {error && (
            <div className="flex items-center gap-2 bg-[var(--color-danger-muted)] px-4 py-1.5 text-xs text-[var(--color-danger)]">
              <AlertTriangle size={12} className="shrink-0" />
              <span className="truncate">{error}</span>
            </div>
          )}

          <div
            className="group/progress relative h-2 cursor-pointer touch-none bg-[var(--color-bg-muted)] sm:h-1"
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
            <div
              className="h-full bg-gradient-to-r from-[var(--color-accent)] via-[var(--color-sub-accent)] to-[var(--color-accent)] transition-[width] duration-100"
              style={{ width: `${progressPct}%` }}
            />
            <div
              className="absolute top-1/2 h-4 w-4 -translate-y-1/2 -translate-x-1/2 rounded-full bg-[var(--color-accent)] shadow-[0_0_0_2px_var(--color-bg)] opacity-0 transition-opacity group-hover/progress:opacity-100"
              style={{ left: `${progressPct}%` }}
            />
          </div>

          <div className="flex flex-1 items-center gap-3 px-3 sm:gap-4 sm:px-4">
            <button
              onClick={openFullscreen}
              className="group flex min-w-0 flex-1 items-center gap-3 text-left transition-opacity hover:opacity-90"
              aria-label="Открыть плеер"
            >
              {currentTrack.coverUrl && (
                <motion.div
                  className="relative h-11 w-11 shrink-0 overflow-hidden rounded-[var(--radius-sm)] border border-border"
                  initial={reduce ? false : { scale: 0.8, opacity: 0 }}
                  animate={reduce ? undefined : { scale: 1, opacity: 1 }}
                  key={currentTrack.id}
                >
                  <img src={currentTrack.coverUrl} alt={currentTrack.title} className="h-full w-full object-cover" />
                  <div className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 transition-opacity group-hover:opacity-100">
                    <Maximize2 size={14} className="text-white" />
                  </div>
                </motion.div>
              )}
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{currentTrack.title}</p>
                <p className="truncate text-xs text-muted-foreground">{currentTrack.artist}</p>
              </div>
            </button>

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
                  {isPlaying ? <Pause size={16} /> : <Play size={16} fill="currentColor" />}
                </Button>
              </motion.div>
              <Button onClick={next} variant="ghost" size="icon" aria-label="Следующий">
                <SkipForward size={16} />
              </Button>
              <Button onClick={cycleRepeat} variant="ghost" size="icon" className="hidden md:inline-flex" aria-label="Повтор">
                {repeat === 'one' ? (
                  <Repeat1 size={15} className="text-[var(--color-accent)]" />
                ) : (
                  <Repeat size={15} className={repeat === 'all' ? 'text-[var(--color-accent)]' : 'text-muted-foreground'} />
                )}
              </Button>

              {/* 3-dot menu: add-to-playlist / share / artist. Replaces the
                * previous heart in the central controls cluster. */}
              <div className="relative" ref={menuRef}>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setMenuOpen((v) => !v)}
                  aria-label="Действия с треком"
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                >
                  <MoreHorizontal size={16} />
                </Button>
                <AnimatePresence>
                  {menuOpen && (
                    <motion.div
                      initial={{ opacity: 0, scale: 0.96, y: 4 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.96, y: 4 }}
                      transition={{ duration: 0.12, ease: [0.16, 1, 0.3, 1] }}
                      role="menu"
                      className="absolute bottom-full right-0 z-30 mb-2 w-56 overflow-hidden rounded-[var(--radius-md)] border border-border bg-card shadow-[var(--shadow-lg)]"
                    >
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
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>

            <div className="hidden flex-1 items-center justify-end gap-2 md:flex">
              <span className="text-xs text-muted-foreground">
                {formatTime(progress)} / {formatTime(duration)}
              </span>
              <Button onClick={toggleMute} variant="ghost" size="icon" className="h-9 w-9" aria-label="Звук">
                {muted ? <VolumeX size={15} /> : <Volume2 size={15} />}
              </Button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={muted ? 0 : volume}
                onChange={(e) => setVolume(Number(e.target.value))}
                className="w-24 accent-[var(--color-accent)]"
                aria-label="Громкость"
              />
              <Button onClick={openFullscreen} variant="ghost" size="icon" aria-label="Развернуть">
                <Maximize2 size={15} />
              </Button>
            </div>
          </div>

          {currentTrack && (
            <AddToPlaylistDialog
              track={currentTrack}
              open={addToPlaylistOpen}
              onClose={() => setAddToPlaylistOpen(false)}
            />
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
