import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ChevronDown, Download, Heart, ListOrdered, ListPlus, Loader2, Mic2, Pause, Play, Radio, Repeat, Repeat1, Shuffle,
  SkipBack, SkipForward, Sliders, Upload, Volume2, VolumeX,
} from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { usePlayerStore } from '@/store/player';
import { useAudioPlayer, useAnalyserAmplitude } from '@/hooks/useAudioPlayer';
import { Button } from '@/components/ui/Button';
import { Equalizer } from '@/components/features/Equalizer';
import { AddToPlaylistDialog } from '@/components/features/AddToPlaylistDialog';
import { QueueDialog } from '@/components/features/QueueDialog';
import { TrackOverrideModal } from '@/components/features/TrackOverrideModal';
import { LyricsPanel } from '@/components/features/LyricsPanel';
import { TiltCard } from '@/components/ui/TiltCard';
import { useToggleLike } from '@/hooks/useLibrary';
import { useCoarsePointer } from '@/hooks/useCoarsePointer';
import { downloadTrack } from '@/lib/trackActions';
import { startTrackRadio } from '@/lib/trackRadio';
import type { Track } from '@/types';

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
  const navigate = useNavigate();
  const reduce = useReducedMotion();

  const goToArtist = () => {
    if (!currentTrack?.artistId) return;
    closeFullscreen();
    navigate(`/artist/${currentTrack.artistId}`);
  };
  const [eqOpen, setEqOpen] = useState(false);
  const [lyricsOpen, setLyricsOpen] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);
  const [addToPlaylistOpen, setAddToPlaylistOpen] = useState(false);
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [radioBusy, setRadioBusy] = useState(false);
  const amp = useAnalyserAmplitude(Boolean(fullscreen) && isPlaying, 'bass');
  // amp is 0..~0.6 from the bass band; scale up a touch so weaker bass is
  // still visible. The smoothing is now lighter (tau=110ms in the hook),
  // so the glow tracks the kick more closely without being epileptic.
  const pulse = Math.min(1, amp * 2.6);
  const { isLiked, toggle } = useToggleLike();
  const liked = currentTrack ? isLiked(currentTrack.id) : false;
  const coarse = useCoarsePointer();

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
    } catch (err) {
      console.error('[radio]', err);
      setDownloadError(err instanceof Error ? err.message : 'Не удалось запустить волну');
      window.setTimeout(() => setDownloadError(null), 4000);
    } finally {
      setRadioBusy(false);
    }
  };

  const handleDownload = async () => {
    if (!currentTrack || downloading) return;
    setDownloading(true);
    setDownloadError(null);
    try {
      await downloadTrack(currentTrack);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Не удалось скачать';
      console.error('[download]', err);
      setDownloadError(message);
      window.setTimeout(() => setDownloadError(null), 5000);
    } finally {
      setDownloading(false);
    }
  };

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
          {(currentTrack.coverUrl || currentTrack.coverVideoUrl) && (
            <>
              {currentTrack.coverVideoUrl ? (
                <video
                  key={currentTrack.coverVideoUrl + '-bg'}
                  src={currentTrack.coverVideoUrl}
                  className="pointer-events-none absolute inset-0 -z-10 h-full w-full object-cover opacity-50 blur-3xl saturate-150 scale-110"
                  autoPlay
                  muted
                  loop
                  playsInline
                  preload="auto"
                  aria-hidden
                  disablePictureInPicture
                  controlsList="nofullscreen nodownload noremoteplayback"
                />
              ) : (
                <div
                  className="absolute inset-0 -z-10 bg-cover bg-center opacity-50 blur-3xl saturate-150"
                  style={{ backgroundImage: `url(${currentTrack.coverUrl})` }}
                  aria-hidden
                />
              )}
              <div className="absolute inset-0 -z-10 bg-gradient-to-b from-black/30 to-black/80" aria-hidden />
              <div
                className="pointer-events-none absolute inset-x-0 top-0 -z-[5] h-52"
                style={{
                  background: 'linear-gradient(to bottom, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.35) 25%, rgba(0,0,0,0.18) 50%, rgba(0,0,0,0.06) 75%, transparent 100%)',
                }}
                aria-hidden
              />
            </>
          )}

          <div className="relative flex items-center justify-between px-5 py-4">
            <Button variant="ghost" size="icon" onClick={closeFullscreen} aria-label="Свернуть">
              <ChevronDown size={20} />
            </Button>
            <span className="pointer-events-none absolute inset-x-0 top-0 flex h-full items-center justify-center text-xs font-medium uppercase tracking-[0.25em] text-muted-foreground">
              Сейчас играет
            </span>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                onClick={handleStartRadio}
                aria-label="Запустить волну"
                disabled={radioBusy}
                title="Запустить волну на основе этого трека"
              >
                {radioBusy ? <Loader2 size={18} className="animate-spin" /> : <Radio size={18} />}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setQueueOpen(true)}
                aria-label="Очередь"
              >
                <ListOrdered size={18} />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setLyricsOpen((v) => !v)}
                aria-label="Текст песни"
                className={lyricsOpen ? 'text-foreground' : ''}
              >
                <Mic2 size={18} />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setEqOpen((v) => !v)}
                aria-label="Эквалайзер"
                className={eqOpen ? 'text-foreground' : ''}
              >
                <Sliders size={18} />
              </Button>
            </div>
          </div>

          <div className="relative flex flex-1 overflow-hidden">
          <div className="relative flex flex-1 flex-col items-center justify-center gap-6 px-6 pb-4 sm:gap-8">
            <motion.div
              key={currentTrack.id}
              initial={reduce ? false : { opacity: 0, scale: 0.92 }}
              animate={reduce ? undefined : { opacity: 1, scale: 1 }}
              transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
              className="relative w-full max-w-md"
            >
              {(currentTrack.coverUrl || currentTrack.coverVideoUrl) && (
                <motion.div
                  aria-hidden
                  className="pointer-events-none absolute inset-0 -z-10 overflow-hidden"
                  animate={reduce ? undefined : {
                    scale: 1.04 + pulse * 0.12,
                    opacity: 0.45 + pulse * 0.3,
                    filter: `blur(${72 + pulse * 22}px) saturate(${1.3 + pulse * 0.35})`,
                  }}
                  transition={{ type: 'spring', stiffness: 70, damping: 18, mass: 0.6 }}
                  style={{ borderRadius: 'var(--radius-xl)' }}
                >
                  {currentTrack.coverVideoUrl ? (
                    <video
                      key={currentTrack.coverVideoUrl + '-glow'}
                      src={currentTrack.coverVideoUrl}
                      className="h-full w-full object-cover pointer-events-none"
                      autoPlay
                      muted
                      loop
                      playsInline
                      preload="auto"
                      aria-hidden
                      disablePictureInPicture
                      controlsList="nofullscreen nodownload noremoteplayback"
                    />
                  ) : (
                    <div
                      className="h-full w-full bg-cover bg-center"
                      style={{ backgroundImage: `url(${currentTrack.coverUrl})` }}
                    />
                  )}
                </motion.div>
              )}
              <TiltCard
                intensity={20}
                hoverScale={1.06}
                glareStrength={0.7}
                glare
                className="aspect-square overflow-hidden rounded-[var(--radius-xl)] border border-border shadow-2xl transition-shadow duration-300 hover:shadow-[0_25px_80px_-15px_rgba(0,0,0,0.55)]"
              >
                {currentTrack.coverVideoUrl ? (
                  // Animated cover (Tidal mp4). Falls back gracefully — the
                  // <img> stays under the <video> as a poster so even if the
                  // mp4 fails to load we still see a static cover.
                  <div className="relative h-full w-full">
                    {currentTrack.coverUrl && (
                      <img
                        src={currentTrack.coverUrl}
                        alt={currentTrack.title}
                        className="absolute inset-0 h-full w-full object-cover"
                      />
                    )}
                    <video
                      key={currentTrack.coverVideoUrl}
                      src={currentTrack.coverVideoUrl}
                      poster={currentTrack.coverUrl}
                      className="relative z-[1] h-full w-full object-cover"
                      autoPlay
                      muted
                      loop
                      playsInline
                      preload="auto"
                      aria-hidden
                      disablePictureInPicture
                      controlsList="nofullscreen nodownload noremoteplayback"
                    />
                  </div>
                ) : currentTrack.coverUrl ? (
                  <img src={currentTrack.coverUrl} alt={currentTrack.title} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center bg-secondary text-muted-foreground">
                    Без обложки
                  </div>
                )}
              </TiltCard>
            </motion.div>

            <div className="flex w-full max-w-md items-center gap-2">
              <Button
                variant="ghost"
                size="icon"
                aria-label="Добавить в плейлист"
                onClick={() => currentTrack && setAddToPlaylistOpen(true)}
                className="shrink-0 h-10 w-10 text-muted-foreground hover:text-foreground"
              >
                <ListPlus size={20} />
              </Button>

              <div className="flex min-w-0 flex-1 flex-col items-center gap-1 text-center">
                <motion.h1
                  key={currentTrack.id + '-title'}
                  initial={reduce ? false : { opacity: 0, y: 8 }}
                  animate={reduce ? undefined : { opacity: 1, y: 0 }}
                  transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
                  className="line-clamp-2 text-2xl font-semibold tracking-tight sm:text-3xl"
                >
                  {currentTrack.title}
                </motion.h1>
                {currentTrack.artistId ? (
                  <button
                    type="button"
                    onClick={goToArtist}
                    className="truncate text-left text-sm text-muted-foreground transition-colors hover:text-foreground hover:underline-offset-4 sm:text-base"
                  >
                    {currentTrack.artist}
                  </button>
                ) : (
                  <p className="truncate text-sm text-muted-foreground sm:text-base">{currentTrack.artist}</p>
                )}
                {error && (
                  <p className="rounded-full bg-[var(--color-danger-muted)] px-3 py-1 text-xs text-[var(--color-danger)]">
                    {error}
                  </p>
                )}
              </div>

              <Button
                variant="ghost"
                size="icon"
                aria-label={liked ? 'Убрать лайк' : 'Лайк'}
                onClick={() => currentTrack && toggle(currentTrack)}
                className={'shrink-0 h-10 w-10 ' + (liked ? 'text-foreground' : 'text-muted-foreground hover:text-foreground')}
              >
                <Heart size={20} fill={liked ? 'currentColor' : 'none'} />
              </Button>
            </div>

            <div className="flex w-full max-w-md flex-col gap-2">
              <div
                className="group/progress relative flex h-6 cursor-pointer touch-none items-center select-none"
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
                <div className="relative h-1 w-full rounded-full bg-white/15 transition-[height] duration-150 group-hover/progress:h-1.5 group-active/progress:h-1.5">
                  <div
                    className="h-full rounded-full bg-white/85 transition-[width] duration-100"
                    style={{ width: `${progressPct}%` }}
                  />
                  <div
                    className="pointer-events-none absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_2px_8px_rgba(0,0,0,0.5)] transition-transform duration-150 group-hover/progress:scale-110 group-active/progress:scale-125"
                    style={{ left: `${progressPct}%` }}
                  />
                </div>
              </div>
              <div className="flex justify-between text-xs tabular-nums text-muted-foreground">
                <span>{formatTime(progress)}</span>
                <span>{formatTime(duration)}</span>
              </div>
            </div>

            <div className="flex w-full max-w-md items-center justify-between">
              <Button variant="ghost" size="icon" onClick={toggleShuffle} aria-label="Перемешать">
                <Shuffle size={18} className={shuffle ? 'text-foreground' : 'text-muted-foreground'} />
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
                  <Repeat1 size={18} className="text-foreground" />
                ) : (
                  <Repeat size={18} className={repeat === 'all' ? 'text-foreground' : 'text-muted-foreground'} />
                )}
              </Button>
            </div>

            {!coarse && (
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
                  className="flex-1 accent-white"
                  aria-label="Громкость"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Скачать"
                  onClick={handleDownload}
                  disabled={downloading}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <Download size={16} />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Загрузить свою версию"
                  onClick={() => setOverrideOpen(true)}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <Upload size={16} />
                </Button>
              </div>
            )}
            <AnimatePresence>
              {downloadError && (
                <motion.div
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  className="rounded-full bg-[var(--color-danger-muted)] px-3 py-1 text-xs text-[var(--color-danger)]"
                >
                  {downloadError}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Desktop side-panel: takes ~half the row when open. */}
          {currentTrack && lyricsOpen && (
            <div className="hidden md:flex md:basis-[44%] lg:basis-[42%] xl:basis-2/5">
              <LyricsPanel
                trackId={currentTrack.id}
                open={lyricsOpen}
                onClose={() => setLyricsOpen(false)}
                mode="side"
                onSeek={seek}
              />
            </div>
          )}
          </div>

          {/* Mobile overlay: covers the whole player surface. */}
          {currentTrack && (
            <LyricsPanel
              trackId={currentTrack.id}
              open={lyricsOpen}
              onClose={() => setLyricsOpen(false)}
              mode="overlay"
              onSeek={seek}
            />
          )}

          <AddToPlaylistDialog
            open={addToPlaylistOpen}
            onClose={() => setAddToPlaylistOpen(false)}
            track={currentTrack}
          />

          <QueueDialog open={queueOpen} onClose={() => setQueueOpen(false)} />

          {currentTrack && (
            <TrackOverrideModal
              open={overrideOpen}
              onClose={() => setOverrideOpen(false)}
              trackId={currentTrack.id}
              trackTitle={`${currentTrack.artist} — ${currentTrack.title}`}
            />
          )}

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
