import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ChevronDown, Disc, Download, Heart, ListOrdered, ListPlus, Loader2, Mic2, MoreHorizontal, Pause, Play, Radio, Repeat, Repeat1, Share2, Shuffle,
  SkipBack, SkipForward, Sliders, Upload, User, Volume2, VolumeX, Check,
} from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion, useTransform } from 'motion/react';
import { usePlayerStore } from '@/store/player';
import { useAudioPlayer, useAnalyserAmplitude, usePlaybackVisuals } from '@/hooks/useAudioPlayer';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { Button } from '@/components/ui/Button';
import { PopoverMenu, MenuItem, MenuDivider } from '@/components/ui/PopoverMenu';
import { Marquee } from '@/components/ui/Marquee';
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
    currentTrack, isPlaying, togglePlay, nextManual, previous,
    muted, toggleMute, volume, setVolume,
    shuffle, toggleShuffle, repeat, cycleRepeat,
    duration, fullscreen, closeFullscreen, error,
  } = usePlayerStore();
  const { progress, seek } = useAudioPlayer();
  const { progressSeconds, bufferedSeconds, durationSeconds } = usePlaybackVisuals();
  // rAF-driven progress + buffered widths so the bar slides smoothly
  // between timeupdate events. See `usePlaybackVisuals` for details.
  const progressWidth = useTransform([progressSeconds, durationSeconds] as unknown as never, ([t, d]: [number, number]) =>
    d > 0 ? `${Math.min(100, (t / d) * 100)}%` : '0%');
  const bufferedWidth = useTransform([bufferedSeconds, durationSeconds] as unknown as never, ([b, d]: [number, number]) =>
    d > 0 ? `${Math.min(100, (b / d) * 100)}%` : '0%');
  const navigate = useNavigate();
  const reduce = useReducedMotion();
  // Lyrics is only rendered as a side-panel on md+; on narrow widths it
  // becomes a full-surface overlay and the cover stays put. We need to
  // know which mode we're in so the cover-shift translateX only fires
  // when there's actually a side-panel taking up space next to it.
  const isMdUp = useMediaQuery('(min-width: 768px)');

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
  const [moreOpen, setMoreOpen] = useState(false);
  const moreTriggerRef = useRef<HTMLButtonElement>(null);
  const amp = useAnalyserAmplitude(Boolean(fullscreen) && isPlaying, 'bass');
  // amp is 0..~0.6 from the bass band (30–180Hz). We subtract a small noise
  // floor first so room tone / mid-bleed doesn't keep the glow swimming
  // when there's no actual kick — the glow should sit still during quiet
  // passages and only react to real bass content.
  const pulse = Math.min(1, Math.sqrt(Math.max(0, amp - 0.06) * 3.4));
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

  const [shareCopied, setShareCopied] = useState(false);
  const handleShare = async () => {
    if (!currentTrack) return;
    // The repo deploys under a sub-path on GitHub Pages
    // (`/bratan-music/`). `window.location.origin + import.meta.env.BASE_URL`
    // gives us the canonical public URL prefix in any environment
    // (dev, preview, production) without hard-coding it.
    const base = window.location.origin + import.meta.env.BASE_URL.replace(/\/$/, '');
    const url = `${base}/track/${currentTrack.id}`;
    const shareText = `${currentTrack.artist} — ${currentTrack.title}`;
    try {
      // Native share sheet on mobile (Android intent picker, iOS sheet,
      // desktop Edge / mobile Safari). Falls back to clipboard copy.
      if (typeof navigator.share === 'function') {
        await navigator.share({ title: shareText, text: shareText, url });
        setMoreOpen(false);
        return;
      }
      await navigator.clipboard.writeText(url);
      setShareCopied(true);
      // Keep the menu open just long enough to show the confirmation,
      // then dismiss so it doesn't linger.
      window.setTimeout(() => {
        setShareCopied(false);
        setMoreOpen(false);
      }, 1400);
    } catch (err) {
      // AbortError: user dismissed the share sheet — silently ignore
      // and close the menu (matches the success path).
      if (err instanceof Error && err.name === 'AbortError') {
        setMoreOpen(false);
        return;
      }
      console.error('[share]', err);
      setMoreOpen(false);
    }
  };

  const goToAlbum = () => {
    if (!currentTrack?.albumId) return;
    closeFullscreen();
    navigate(`/album/${currentTrack.albumId}`);
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
          className="fullscreen-player fixed inset-0 z-50 flex flex-col overflow-hidden"
        >
          {/* Background layers: solid bg → ambient blurred cover → vignette
              The cover is heavily blurred and over-scaled so the player
              backdrop reads as a single tinted ambient field — no visible
              edges or contrast bands from the source image. */}
          <div className="absolute inset-0 z-0 bg-[var(--color-bg)]" aria-hidden />
          {(currentTrack.coverUrl || currentTrack.coverVideoUrl) && (
            <>
              {currentTrack.coverVideoUrl ? (
                <video
                  key={currentTrack.coverVideoUrl + '-bg'}
                  src={currentTrack.coverVideoUrl}
                  className="pointer-events-none absolute inset-0 z-[1] h-full w-full object-cover opacity-60 saturate-150"
                  style={{ filter: 'blur(140px) saturate(1.6)', transform: 'scale(1.4)' }}
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
                <>
                  <div
                    className="absolute inset-0 z-[1]"
                    style={{
                      backgroundImage: `url(${currentTrack.coverUrl})`,
                      backgroundSize: '180% 180%',
                      backgroundPosition: 'center 30%',
                      filter: 'blur(140px) saturate(1.6)',
                      transform: 'scale(1.4)',
                      opacity: 0.6,
                    }}
                    aria-hidden
                  />
                  <div
                    className="absolute inset-0 z-[1]"
                    style={{
                      backgroundImage: `url(${currentTrack.coverUrl})`,
                      backgroundSize: '220% 220%',
                      backgroundPosition: 'center 70%',
                      filter: 'blur(180px) saturate(1.4) hue-rotate(8deg)',
                      transform: 'scale(1.4)',
                      opacity: 0.35,
                    }}
                    aria-hidden
                  />
                </>
              )}
              {/* Top + bottom soft vignettes. The TOP one absorbs the
                  cover halo's natural blur bleed before it reaches the
                  header bar — without it, on bright covers + bass kicks
                  the halo's pulsing was visibly painting through the
                  (transparent) header as a "torn light strip" right at
                  the top of the viewport. Darkening this strip turns
                  that bleed into ambient depth instead of a visible
                  band, and the header's `text-shadow` keeps the title
                  readable on top.

                  Bottom vignette (unchanged) gives the controls and
                  volume row enough contrast to read on light covers. */}
              <div
                className="pointer-events-none absolute inset-x-0 top-0 z-[2] h-40"
                style={{
                  background:
                    'linear-gradient(to bottom, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.18) 55%, transparent 100%)',
                }}
                aria-hidden
              />
              <div
                className="pointer-events-none absolute inset-0 z-[2]"
                style={{
                  background:
                    'linear-gradient(to bottom, transparent 0%, transparent 70%, rgba(0,0,0,0.45) 100%)',
                }}
                aria-hidden
              />
            </>
          )}

          <div className="relative z-[20] flex items-center justify-between px-5 py-4">
            <Button variant="ghost" size="icon" onClick={closeFullscreen} aria-label="Свернуть">
              <ChevronDown size={20} />
            </Button>
            <span className="pointer-events-none absolute inset-x-0 top-0 flex h-full items-center justify-center text-xs font-medium uppercase tracking-[0.25em] text-muted-foreground">
              Сейчас играет
            </span>
            <div className="flex items-center gap-1">
              {/* Desktop: spell out the track-side actions inline. On mobile
                  these collapse into the 3-dots dropdown below to keep the
                  header uncluttered. Download/upload always live in the menu
                  to avoid crowding the volume row. */}
              <Button
                variant="ghost"
                size="icon"
                onClick={handleStartRadio}
                aria-label="Запустить волну"
                disabled={radioBusy}
                title="Запустить волну на основе этого трека"
                className="hidden md:inline-flex"
              >
                {radioBusy ? <Loader2 size={18} className="animate-spin" /> : <Radio size={18} />}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setQueueOpen(true)}
                aria-label="Очередь"
                className="hidden md:inline-flex"
              >
                <ListOrdered size={18} />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setLyricsOpen((v) => !v)}
                aria-label="Текст песни"
                className={(lyricsOpen ? 'text-foreground ' : '') + 'hidden md:inline-flex'}
              >
                <Mic2 size={18} />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setEqOpen((v) => !v)}
                aria-label="Эквалайзер"
                className={(eqOpen ? 'text-foreground ' : '') + 'hidden md:inline-flex'}
              >
                <Sliders size={18} />
              </Button>

              <Button
                ref={moreTriggerRef}
                variant="ghost"
                size="icon"
                onClick={() => setMoreOpen((v) => !v)}
                aria-label="Действия с треком"
                aria-haspopup="menu"
                aria-expanded={moreOpen}
              >
                <MoreHorizontal size={18} />
              </Button>
              <PopoverMenu
                open={moreOpen}
                onClose={() => setMoreOpen(false)}
                triggerRef={moreTriggerRef}
                anchor="bottom"
                align="end"
                width={240}
              >
                {/* Mobile-only group: surfaces the four track-side actions
                    that are inline buttons on md+ but collapse here on
                    narrow widths. */}
                <MenuItem
                  mobileOnly
                  onClick={() => { handleStartRadio(); setMoreOpen(false); }}
                  disabled={radioBusy}
                  icon={radioBusy ? <Loader2 size={14} className="animate-spin" /> : <Radio size={14} />}
                >
                  Запустить волну
                </MenuItem>
                <MenuItem
                  mobileOnly
                  onClick={() => { setQueueOpen(true); setMoreOpen(false); }}
                  icon={<ListOrdered size={14} />}
                >
                  Очередь
                </MenuItem>
                <MenuItem
                  mobileOnly
                  onClick={() => { setLyricsOpen((v) => !v); setMoreOpen(false); }}
                  icon={<Mic2 size={14} />}
                >
                  {lyricsOpen ? 'Скрыть текст' : 'Текст песни'}
                </MenuItem>
                <MenuItem
                  mobileOnly
                  onClick={() => { setEqOpen((v) => !v); setMoreOpen(false); }}
                  icon={<Sliders size={14} />}
                >
                  {eqOpen ? 'Скрыть эквалайзер' : 'Эквалайзер'}
                </MenuItem>
                {/* Mobile-only — surface shuffle/repeat in the menu so the
                    user has a discoverable place to toggle them; the
                    inline icons in the bottom control row are tiny on
                    small phones. */}
                <MenuItem
                  mobileOnly
                  onClick={() => { toggleShuffle(); setMoreOpen(false); }}
                  icon={<Shuffle size={14} className={shuffle ? 'text-foreground' : ''} />}
                >
                  Перемешать{shuffle ? ' (вкл.)' : ''}
                </MenuItem>
                <MenuItem
                  mobileOnly
                  onClick={() => { cycleRepeat(); setMoreOpen(false); }}
                  icon={repeat === 'one' ? <Repeat1 size={14} className="text-foreground" /> : <Repeat size={14} className={repeat === 'all' ? 'text-foreground' : ''} />}
                >
                  Повтор{repeat === 'all' ? ' (всё)' : repeat === 'one' ? ' (один)' : ''}
                </MenuItem>
                <MenuDivider mobileOnly />

                {/* Always-shown: track navigation + library actions. Most
                    of these would otherwise require closing the fullscreen
                    player to reach. */}
                <MenuItem
                  onClick={() => { setAddToPlaylistOpen(true); setMoreOpen(false); }}
                  icon={<ListPlus size={14} />}
                >
                  Добавить в плейлист
                </MenuItem>
                {currentTrack.artistId && (
                  <MenuItem
                    onClick={() => { goToArtist(); setMoreOpen(false); }}
                    icon={<User size={14} />}
                  >
                    Перейти к артисту
                  </MenuItem>
                )}
                {currentTrack.albumId && (
                  <MenuItem
                    onClick={() => { goToAlbum(); setMoreOpen(false); }}
                    icon={<Disc size={14} />}
                  >
                    Перейти к альбому
                  </MenuItem>
                )}
                <MenuDivider />
                <MenuItem
                  onClick={handleShare}
                  icon={shareCopied ? <Check size={14} className="text-[var(--color-accent)]" /> : <Share2 size={14} />}
                >
                  {shareCopied ? 'Ссылка скопирована' : 'Поделиться'}
                </MenuItem>
                <MenuItem
                  onClick={() => { handleDownload(); setMoreOpen(false); }}
                  disabled={downloading}
                  icon={downloading ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                >
                  Скачать
                </MenuItem>
                <MenuItem
                  onClick={() => { setOverrideOpen(true); setMoreOpen(false); }}
                  icon={<Upload size={14} />}
                >
                  Загрузить свою версию
                </MenuItem>
              </PopoverMenu>
            </div>
          </div>

          {/* Body row. We deliberately do NOT use `overflow-hidden` here:
              the cover has a pulsing blur halo (-z-10, blur up to ~94px,
              scale up to 1.16) that bleeds beyond its bounding box, and
              clipping that bleed at the body's edge produced a visible
              horizontal band right under the header on light-coloured
              covers. The outer fullscreen <motion.div> already has
              overflow-hidden so nothing escapes the viewport. */}
          <div className="relative z-[3] flex flex-1 min-h-0">
          {/* Cover column. Stays full-width across the whole row; when
              the lyrics side-panel mounts it gets translated left by a
              fixed % so the cover content visually centres in the
              remaining space without any width animation (the previous
              flex-basis layout animation made the column "stretch"
              which the user found jerky). md+ only — on narrow widths
              the lyrics is rendered as an overlay and the cover stays
              put. */}
          <motion.div
            animate={reduce ? undefined : { x: lyricsOpen && isMdUp ? '-22%' : '0%' }}
            transition={{ type: 'spring', stiffness: 240, damping: 32, mass: 0.85 }}
            // No top padding — the user wants the cover to butt right up
            // against the header bar's bottom edge (the bar's own `py-4`
            // already buffers its content so the cover doesn't visually
            // crowd the title). Bottom padding is kept small so the volume
            // slider sits comfortably above the safe area.
            className="relative flex min-h-0 flex-1 flex-col items-center justify-center gap-6 px-6 pb-4 sm:gap-8 md:transform-gpu"
          >
            {/* Cover artwork wrapper. The halo (-z-10 inside) is sized
                to the cover but its filter blur paints freely outside
                the box — we deliberately do NOT clip or shrink it any
                more. The "torn light strip" the user used to see at
                the top of the viewport from the halo's bleed is now
                handled by a top-side darkening vignette (mirrors the
                bottom one) so the bleed reads as ambient depth rather
                than a visible band. */}
            <motion.div
              key={currentTrack.id}
              initial={reduce ? false : { opacity: 0, scale: 0.92 }}
              animate={reduce ? undefined : { opacity: 1, scale: 1 }}
              transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
              className="relative mx-auto aspect-square w-full max-w-md"
            >
              {(currentTrack.coverUrl || currentTrack.coverVideoUrl) && (
                <motion.div
                  aria-hidden
                  className="pointer-events-none absolute inset-0 -z-10 overflow-hidden"
                  animate={reduce ? undefined : {
                    // Bass-only pulse (the amplitude hook is fed the
                    // 30–180Hz band). Free bleed: the glow is allowed
                    // to spread to its full natural radius — the top
                    // vignette + bottom vignette together absorb the
                    // bleed visually, so we don't need to clip or
                    // mask the halo itself.
                    scale: 1.0 + pulse * 0.18,
                    opacity: 0.32 + pulse * 0.44,
                    filter: `blur(${56 + pulse * 32}px) saturate(${1.2 + pulse * 0.6}) brightness(${1 + pulse * 0.36})`,
                  }}
                  transition={{ type: 'spring', stiffness: 200, damping: 18, mass: 0.55 }}
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

              <div className="flex min-w-0 flex-1 flex-col items-stretch gap-1">
                <motion.div
                  key={currentTrack.id + '-title'}
                  initial={reduce ? false : { opacity: 0, y: 8 }}
                  animate={reduce ? undefined : { opacity: 1, y: 0 }}
                  transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
                  className="text-center"
                >
                  <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
                    <Marquee text={currentTrack.title} />
                  </h1>
                </motion.div>
                {/* Always render the artist line inside a `block w-full
                    text-center` shell so short and long names sit at
                    the same horizontal centre as the title above —
                    previously the no-artistId branch let the Marquee
                    inherit the parent flex column's `items-stretch`
                    default and the text drifted to the left edge. */}
                {currentTrack.artistId ? (
                  <button
                    type="button"
                    onClick={goToArtist}
                    className="block w-full text-center text-sm text-muted-foreground transition-colors hover:text-foreground hover:underline-offset-4 sm:text-base"
                  >
                    <Marquee text={currentTrack.artist} />
                  </button>
                ) : (
                  <div className="block w-full text-center text-sm text-muted-foreground sm:text-base">
                    <Marquee text={currentTrack.artist} />
                  </div>
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
                <div className="relative h-1 w-full overflow-hidden rounded-full bg-white/15 transition-[height] duration-150 group-hover/progress:h-1.5 group-active/progress:h-1.5">
                  {/* Buffered range — light bar that runs ahead of the
                      played portion to show how far the audio is already
                      downloaded. Sits behind the played bar and gets
                      covered as playback catches up. */}
                  <motion.div
                    className="absolute inset-y-0 left-0 rounded-full bg-white/30"
                    style={{ width: bufferedWidth }}
                    aria-hidden
                  />
                  <motion.div
                    className="absolute inset-y-0 left-0 rounded-full bg-white/85"
                    style={{ width: progressWidth }}
                  />
                </div>
                {/* Thumb is rendered as a sibling of the rail (not inside)
                    so it isn't clipped by the rail's `overflow-hidden`,
                    which is needed to keep rounded edges on the fill. The
                    outer `.group/progress` is `relative h-6 items-center`,
                    so `top-1/2 -translate-y-1/2` vertically centres the
                    thumb on the rail regardless of the rail's animated
                    height (1px → 1.5px on hover/drag). */}
                <motion.div
                  className="pointer-events-none absolute top-1/2 z-10 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_2px_8px_rgba(0,0,0,0.5)] transition-transform duration-150 group-hover/progress:scale-110 group-active/progress:scale-125"
                  style={{ left: progressWidth }}
                  aria-hidden
                />
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
                  {isPlaying ? <Pause size={24} fill="currentColor" strokeWidth={0} /> : <Play size={24} fill="currentColor" />}
                </Button>
              </motion.div>
              <Button variant="ghost" size="icon" onClick={nextManual} aria-label="Вперёд" className="h-12 w-12">
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
                {/* Custom volume slider — same look & thickness as the
                    progress bar above (h-1 default, h-1.5 on hover/drag,
                    same 3px round thumb). Native <input type=range> couldn't
                    match the rail thickness reliably across browsers. */}
                <div
                  className="group/volume relative flex h-6 flex-1 cursor-pointer touch-none items-center select-none"
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
                  <div className="relative h-1 w-full rounded-full bg-white/15 transition-[height] duration-150 group-hover/volume:h-1.5 group-active/volume:h-1.5">
                    <div
                      className="h-full rounded-full bg-white/85 transition-[width] duration-100"
                      style={{ width: `${(muted ? 0 : volume) * 100}%` }}
                    />
                    <div
                      className="pointer-events-none absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_2px_8px_rgba(0,0,0,0.5)] transition-transform duration-150 group-hover/volume:scale-110 group-active/volume:scale-125"
                      style={{ left: `${(muted ? 0 : volume) * 100}%` }}
                    />
                  </div>
                </div>
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
          </motion.div>

          {/* Desktop side-panel: positioned absolutely over the right
              portion of the row (md:w-[44%] etc.) so the cover column
              never has to animate its width. It slides in from the
              right via the LyricsPanel's own enter/exit animation,
              while the cover translates left by `-22%` (motion.div
              above) to visually re-centre in the remaining space. */}
          {currentTrack && (
            <div
              className={`absolute inset-y-0 right-0 hidden md:block md:w-[44%] lg:w-[42%] xl:w-[40%] ${
                lyricsOpen ? 'pointer-events-auto' : 'pointer-events-none'
              }`}
            >
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
