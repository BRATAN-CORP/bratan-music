import { useEffect, useState } from 'react';
import {
  ChevronDown, Heart, Pause, Play, Repeat, Repeat1, Shuffle,
  SkipBack, SkipForward, Sliders, Volume2, VolumeX,
} from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { usePlayerStore } from '@/store/player';
import { useAudioPlayer, useAnalyserAmplitude } from '@/hooks/useAudioPlayer';
import { Button } from '@/components/ui/Button';
import { Equalizer } from '@/components/features/Equalizer';
import { TiltCard } from '@/components/ui/TiltCard';
import { useToggleLike } from '@/hooks/useLibrary';

function formatTime(seconds: number): string {
  if (!seconds || !isFinite(seconds)) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function FullscreenPlayer() {
  const {
    currentTrack, isPlaying, togglePlay, next, previous,
    muted, toggleMute, volume, setVolume,
    shuffle, toggleShuffle, repeat, cycleRepeat,
    duration, fullscreen, closeFullscreen, error,
  } = usePlayerStore();
  const { progress, seek } = useAudioPlayer();
  const reduce = useReducedMotion();
  const [eqOpen, setEqOpen] = useState(false);
  const amp = useAnalyserAmplitude(Boolean(fullscreen) && isPlaying);
  // amp is 0..~0.6, normalize to a calm pulse range
  const pulse = Math.min(1, amp * 2.4);
  const { isLiked, toggle } = useToggleLike();
  const liked = currentTrack ? isLiked(currentTrack.id) : false;

  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeFullscreen();
      if (e.key === ' ') {
        e.preventDefault();
        togglePlay();
      }
    };
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = '';
      window.removeEventListener('keydown', onKey);
    };
  }, [fullscreen, closeFullscreen, togglePlay]);

  const progressPct = duration > 0 ? (progress / duration) * 100 : 0;

  return (
    <AnimatePresence>
      {fullscreen && currentTrack && (
        <motion.div
          key="fullscreen-player"
          initial={reduce ? false : { opacity: 0 }}
          animate={reduce ? undefined : { opacity: 1 }}
          exit={reduce ? undefined : { opacity: 0 }}
          transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
          className="fixed inset-0 z-50 flex flex-col overflow-hidden bg-[var(--color-bg)]"
        >
          {currentTrack.coverUrl && (
            <>
              <div
                className="absolute inset-0 -z-10 bg-cover bg-center opacity-50 blur-3xl saturate-150"
                style={{ backgroundImage: `url(${currentTrack.coverUrl})` }}
                aria-hidden
              />
              <div className="absolute inset-0 -z-10 bg-gradient-to-b from-black/40 via-black/60 to-black/80" aria-hidden />
            </>
          )}

          <div className="relative flex items-center justify-between px-5 py-4">
            <Button variant="ghost" size="icon" onClick={closeFullscreen} aria-label="Свернуть">
              <ChevronDown size={20} />
            </Button>
            <span className="text-xs font-medium uppercase tracking-[0.25em] text-muted-foreground">
              Сейчас играет
            </span>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setEqOpen((v) => !v)}
              aria-label="Эквалайзер"
              className={eqOpen ? 'text-[var(--color-accent)]' : ''}
            >
              <Sliders size={18} />
            </Button>
          </div>

          <div className="relative flex flex-1 flex-col items-center justify-center gap-6 px-6 pb-4 sm:gap-8">
            <motion.div
              key={currentTrack.id}
              initial={reduce ? false : { opacity: 0, scale: 0.92 }}
              animate={reduce ? undefined : { opacity: 1, scale: 1 }}
              transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
              className="relative w-full max-w-md"
            >
              {/* glow: duplicated cover behind, blurred + pulsed by audio amplitude */}
              {currentTrack.coverUrl && (
                <motion.div
                  aria-hidden
                  className="pointer-events-none absolute inset-0 -z-10"
                  animate={reduce ? undefined : {
                    scale: 1.05 + pulse * 0.18,
                    opacity: 0.55 + pulse * 0.35,
                    filter: `blur(${72 + pulse * 36}px) saturate(${1.4 + pulse * 0.6})`,
                  }}
                  transition={{ type: 'spring', stiffness: 80, damping: 18, mass: 0.6 }}
                  style={{
                    backgroundImage: `url(${currentTrack.coverUrl})`,
                    backgroundSize: 'cover',
                    backgroundPosition: 'center',
                    borderRadius: 'var(--radius-xl)',
                  }}
                />
              )}
              <TiltCard intensity={10} glare className="aspect-square overflow-hidden rounded-[var(--radius-xl)] border border-border shadow-2xl">
                {currentTrack.coverUrl ? (
                  <img src={currentTrack.coverUrl} alt={currentTrack.title} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center bg-secondary text-muted-foreground">
                    Без обложки
                  </div>
                )}
              </TiltCard>
            </motion.div>

            <div className="flex w-full max-w-md flex-col items-center gap-2 text-center">
              <motion.h1
                key={currentTrack.id + '-title'}
                initial={reduce ? false : { opacity: 0, y: 8 }}
                animate={reduce ? undefined : { opacity: 1, y: 0 }}
                transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
                className="line-clamp-2 text-2xl font-semibold tracking-tight sm:text-3xl"
              >
                {currentTrack.title}
              </motion.h1>
              <p className="text-sm text-muted-foreground sm:text-base">{currentTrack.artist}</p>
              {error && (
                <p className="rounded-full bg-[var(--color-danger-muted)] px-3 py-1 text-xs text-[var(--color-danger)]">
                  {error}
                </p>
              )}
            </div>

            <div className="flex w-full max-w-md flex-col gap-2">
              <div
                className="group/progress relative h-2 cursor-pointer touch-none rounded-full bg-[var(--color-bg-muted)] sm:h-1.5"
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
                  className="h-full rounded-full bg-gradient-to-r from-[var(--color-accent)] via-[var(--color-sub-accent)] to-[var(--color-accent)] transition-[width] duration-100"
                  style={{ width: `${progressPct}%` }}
                />
                <div
                  className="absolute top-1/2 h-4 w-4 -translate-y-1/2 -translate-x-1/2 rounded-full bg-[var(--color-accent)] shadow-[0_0_0_2px_var(--color-bg)] opacity-100 transition-opacity"
                  style={{ left: `${progressPct}%` }}
                />
              </div>
              <div className="flex justify-between text-xs tabular-nums text-muted-foreground">
                <span>{formatTime(progress)}</span>
                <span>{formatTime(duration)}</span>
              </div>
            </div>

            <div className="flex w-full max-w-md items-center justify-between">
              <Button variant="ghost" size="icon" onClick={toggleShuffle} aria-label="Перемешать">
                <Shuffle size={18} className={shuffle ? 'text-[var(--color-accent)]' : 'text-muted-foreground'} />
              </Button>
              <Button variant="ghost" size="icon" onClick={previous} aria-label="Назад" className="h-12 w-12">
                <SkipBack size={22} />
              </Button>
              <motion.div whileTap={reduce ? undefined : { scale: 0.92 }}>
                <Button onClick={togglePlay} className="h-16 w-16 rounded-full" aria-label={isPlaying ? 'Пауза' : 'Пуск'}>
                  {isPlaying ? <Pause size={24} /> : <Play size={24} fill="currentColor" />}
                </Button>
              </motion.div>
              <Button variant="ghost" size="icon" onClick={next} aria-label="Вперёд" className="h-12 w-12">
                <SkipForward size={22} />
              </Button>
              <Button variant="ghost" size="icon" onClick={cycleRepeat} aria-label="Повтор">
                {repeat === 'one' ? (
                  <Repeat1 size={18} className="text-[var(--color-accent)]" />
                ) : (
                  <Repeat size={18} className={repeat === 'all' ? 'text-[var(--color-accent)]' : 'text-muted-foreground'} />
                )}
              </Button>
            </div>

            <div className="flex w-full max-w-md items-center gap-3">
              <Button variant="ghost" size="icon" onClick={toggleMute} aria-label="Звук">
                {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
              </Button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={muted ? 0 : volume}
                onChange={(e) => setVolume(Number(e.target.value))}
                className="flex-1 accent-[var(--color-accent)]"
                aria-label="Громкость"
              />
              <Button
                variant="ghost"
                size="icon"
                aria-label={liked ? 'Убрать лайк' : 'Лайк'}
                className={liked ? 'text-[var(--color-accent)]' : ''}
                onClick={() => currentTrack && toggle(currentTrack)}
              >
                <Heart size={16} fill={liked ? 'currentColor' : 'none'} />
              </Button>
            </div>
          </div>

          <AnimatePresence>
            {eqOpen && (
              <>
                <motion.div
                  key="eq-backdrop"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2, ease: 'easeOut' }}
                  onClick={() => setEqOpen(false)}
                  className="absolute inset-0 z-[5] bg-black/50 backdrop-blur-sm"
                  aria-hidden
                />
                <motion.div
                  key="eq-panel"
                  initial={{ y: 60, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  exit={{ y: 60, opacity: 0 }}
                  transition={{ delay: 0.12, type: 'spring', stiffness: 320, damping: 30 }}
                  className="absolute inset-x-0 bottom-0 z-10 mx-auto w-full max-w-md p-4"
                >
                  <Equalizer />
                </motion.div>
              </>
            )}
          </AnimatePresence>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
