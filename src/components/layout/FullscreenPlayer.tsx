import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowDownToLine, ChevronDown, Disc, Download, Heart, ListOrdered, ListPlus, Loader2, Mic2, MoreHorizontal, Pause, Play, Radio, Repeat, Repeat1, Share2, Shuffle,
  SkipBack, SkipForward, Sliders, Upload, Volume2, VolumeX, Check, Ban, RotateCcw, X,
} from 'lucide-react';
import { animate, AnimatePresence, motion, useDragControls, useMotionValue, useReducedMotion, useTransform } from 'motion/react';
import { usePlayerStore } from '@/store/player';
import { seekAudio, useBassPulse, usePlaybackVisuals } from '@/hooks/useAudioPlayer';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { Button } from '@/components/ui/Button';
import { PopoverMenu, MenuItem, MenuDivider } from '@/components/ui/PopoverMenu';
import { Marquee } from '@/components/ui/Marquee';
import { Equalizer } from '@/components/features/Equalizer';
import { AddToPlaylistDialog } from '@/components/features/AddToPlaylistDialog';
import { QueueDialog } from '@/components/features/QueueDialog';
import { TrackOverrideModal } from '@/components/features/TrackOverrideModal';
import { LyricsPanel, LyricsContent } from '@/components/features/LyricsPanel';
import { ArtistDislikeMenuItems } from '@/components/features/ArtistDislikeMenuItems';
import { ArtistGoToMenuItems } from '@/components/features/ArtistGoToMenuItems';
import { OfflineProgressIcon } from '@/components/features/OfflineProgressIcon';
import { TiltCard } from '@/components/ui/TiltCard';
import { useToggleLike } from '@/hooks/useLibrary';
import { useDislikesStore } from '@/store/dislikes';
import { useToggleDislike } from '@/hooks/useDislikes';
import { useAuthStore } from '@/store/auth';
import { useTrack } from '@/hooks/useTrack';
import { useTouchOnlyDevice } from '@/hooks/useCoarsePointer';
import { useIsTrackSavedOffline, useTrackDownloadJob, useOfflineActions } from '@/hooks/useOfflineActions';
import { useOfflineCoverUrl } from '@/hooks/useOfflineCoverUrl';
import { downloadTrack } from '@/lib/trackActions';
import { startTrackRadio } from '@/lib/trackRadio';
import { ArtistLinks } from '@/components/features/ArtistLinks';
import { ExplicitBadge } from '@/components/features/ExplicitBadge';
import { hasMultiCredit } from '@/lib/artistCredit';
import type { Track } from '@/types';
import { useT } from '@/i18n';
import { toast } from '@/store/toast';

function formatTime(seconds: number): string {
  if (!seconds || !isFinite(seconds)) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function FullscreenPlayer() {
  const t = useT();
  const {
    currentTrack, isPlaying, togglePlay, nextManual, previous,
    muted, toggleMute, volume, setVolume,
    shuffle, toggleShuffle, repeat, cycleRepeat,
    duration, progress, fullscreen, closeFullscreen,
  } = usePlayerStore();
  // IMPORTANT: do NOT call `useAudioPlayer()` here. The hook owns the
  // singleton audio engine — every effect (track-change, play/pause,
  // volume, crossfade trigger, mediaSession, slot listeners …) gets
  // duplicated when more than one component mounts the hook. The mini
  // `Player` already mounts it at the router level, so calling it
  // again here used to spin up a second copy of every effect AS LONG
  // AS the fullscreen player was mounted (it's part of the layout
  // tree, not gated by `fullscreen`). The two copies fought over the
  // same audio element: `setSlotGain` ran twice, the volume effect
  // overwrote `audio.volume` mid-fade (volume jump), `corsRetried`
  // bookkeeping raced (1 s reset only in fullscreen), and the
  // duplicate listeners' `isOwnerSlot()` window let the OUTGOING
  // slot's timeupdate keep clobbering `store.progress` after a manual
  // skip (timer "относится к первой песни"). Match
  // `MobileBottomDock`: read `progress` from the store and call the
  // standalone `seekAudio` for scrub gestures.
  const seek = seekAudio;
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
  // Cover for the active track — switches to the locally-saved blob
  // when the track is in the offline cache so the fullscreen player's
  // ambience layer, bass-driven halo and the main artwork all
  // continue to paint in offline mode. Falls through to the network
  // URL otherwise so non-saved tracks keep streaming the cover from
  // Tidal as before.
  const trackCoverUrl = useOfflineCoverUrl('track', currentTrack?.id, currentTrack?.coverUrl);
  const [eqOpen, setEqOpen] = useState(false);
  const [lyricsOpen, setLyricsOpen] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);
  const [addToPlaylistOpen, setAddToPlaylistOpen] = useState(false);
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [radioBusy, setRadioBusy] = useState(false);
  const [moreOpen, setMoreOpenRaw] = useState(false);
  // The kebab can drill into a per-credit picker for multi-artist
  // tracks. There are two picker variants — "Hide artist" and "Go
  // to artist" — both rendered inside the same popover (so position
  // / outside-click handling stays identical between views).
  const [moreView, setMoreView] = useState<'main' | 'artist-hide-picker' | 'artist-go-picker'>('main');
  const setMoreOpen = (next: boolean | ((v: boolean) => boolean)) => {
    setMoreOpenRaw((prev) => {
      const value = typeof next === 'function' ? (next as (v: boolean) => boolean)(prev) : next;
      if (!value) setMoreView('main');
      return value;
    });
  };
  const moreTriggerRef = useRef<HTMLButtonElement>(null);
  // Bass-only signals (П6). `amp` is the smoothed envelope (0..~0.6),
  // `kick` is a transient detector that briefly spikes whenever the bass
  // amplitude jumps above its slow baseline. We translate those into two
  // visual scalars:
  //   - `pulse` (0..1) drives sustained breathing: scale, opacity, blur.
  //   - `flash` (0..1) drives short visible flashes for visible kicks.
  // `flash` decays in ~280ms so even quiet passages with the occasional
  // soft thump still register visibly.
  const { amp, kick } = useBassPulse(Boolean(fullscreen) && isPlaying);
  const pulse = Math.min(1, Math.sqrt(Math.max(0, amp - 0.05) * 4));
  const flash = Math.min(1, kick);
  const { isLiked, toggle } = useToggleLike();
  const liked = currentTrack ? isLiked(currentTrack.id) : false;
  const isAuthed = useAuthStore((s) => Boolean(s.user));
  const trackDisliked = useDislikesStore((s) => Boolean(currentTrack && s.tracks.has(currentTrack.id)));

  // Offline-save state for the kebab "Слушать офлайн" menu item.
  // Mirrors the logic in `TrackKebabMenu` so the fullscreen kebab
  // exposes the same offline toggle the user reaches through the
  // per-track menu — the previous version of the kebab only had the
  // file-download action ("Скачать файл"), which is a different
  // affordance that the user explicitly asked us to disambiguate.
  const trackSavedOffline = useIsTrackSavedOffline(currentTrack?.id ?? '');
  const trackDownloadJob = useTrackDownloadJob(currentTrack?.id ?? '');
  const isTrackDownloadingOffline =
    trackDownloadJob && (trackDownloadJob.status === 'queued' || trackDownloadJob.status === 'downloading');
  const { saveTrack: saveTrackOffline, unsaveTrack: unsaveTrackOffline, cancelTrack: cancelTrackOffline } = useOfflineActions();
  const handleOfflineToggle = () => {
    if (!currentTrack) return;
    if (isTrackDownloadingOffline) {
      cancelTrackOffline(currentTrack.id);
    } else if (trackSavedOffline) {
      void unsaveTrackOffline(currentTrack.id);
    } else {
      void saveTrackOffline(currentTrack);
    }
  };

  const toggleDislike = useToggleDislike();
  // `touchOnly` is stricter than the legacy `useCoarsePointer` —
  // requires NO hover capability AND coarse pointer, so touchscreen
  // laptops with a trackpad still keep the volume slider. Matches
  // user expectation: volume shows everywhere except real iOS /
  // Android phones / tablets.
  const touchOnly = useTouchOnlyDevice();

  // Enrich playback metadata for tracks that came from the user's
  // library / playlists. Likes saved before we started persisting
  // `coverVideoUrl` in the snapshot have it missing — when the
  // fullscreen player opens we transparently re-fetch the full Tidal
  // track and use its `coverVideoUrl` for the animated cover. We don't
  // touch the player store here (avoids a render storm and keeps
  // offline play working); we just compose the enriched cover into
  // local render variables below. New likes already write the field
  // into the DB snapshot so this fallback is purely for legacy data.
  const snapshotCoverVideoUrl = currentTrack?.coverVideoUrl;
  const needsEnrichment = Boolean(
    fullscreen &&
    currentTrack &&
    !snapshotCoverVideoUrl &&
    currentTrack.id &&
    /^\d+$/.test(currentTrack.id), // Tidal track ids are numeric strings
  );
  const enrichedTrack = useTrack(needsEnrichment ? (currentTrack?.id ?? '') : '');
  const coverVideoUrl = snapshotCoverVideoUrl ?? enrichedTrack.data?.coverVideoUrl;

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
      // Routed through the global toast surface — no more inline pill
      // hijacking the cover area when something goes wrong.
      toast.error(err instanceof Error ? err.message : t('fullscreenPlayer.radioFailed'));
    } finally {
      setRadioBusy(false);
    }
  };

  const handleDownload = async () => {
    if (!currentTrack || downloading) return;
    setDownloading(true);
    try {
      await downloadTrack(currentTrack);
    } catch (err) {
      console.error('[download]', err);
      toast.error(err instanceof Error ? err.message : t('fullscreenPlayer.downloadFailed'));
    } finally {
      setDownloading(false);
    }
  };

  const [shareCopied, setShareCopied] = useState(false);
  // Mirror the mini-player's share behaviour exactly: copy a deep-link
  // straight to the clipboard, no native share sheet, no picker. The
  // user explicitly asked for parity with the mini player, and the
  // share sheet was inconsistent across browsers anyway (mobile Safari
  // showed a picker, desktop Chrome silently failed).
  const handleShare = async () => {
    if (!currentTrack) return;
    const u = new URL(window.location.href);
    const base = `${u.origin}${u.pathname.replace(/\/?(track|search|playlist|album|artist|profile|admin)\/.*$/, '')}`.replace(/\/$/, '');
    const url = `${base}/track/${currentTrack.id}?autoplay=1`;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = url;
      textarea.setAttribute('readonly', '');
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      try { document.execCommand('copy'); } catch { /* ignore */ }
      document.body.removeChild(textarea);
    }
    setShareCopied(true);
    window.setTimeout(() => {
      setShareCopied(false);
      setMoreOpen(false);
    }, 1400);
  };

  const goToAlbum = () => {
    if (!currentTrack?.albumId) return;
    closeFullscreen();
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
    setMoreOpen(false);
  };



  // Vertical drag-to-dismiss (the "swipe down from the top to
  // collapse" gesture the user asked for). The whole fullscreen
  // sheet follows the finger via `sheetY` while dragging — but
  // crucially `sheetY` is applied to an INNER wrapper, separate
  // from the outer `<motion.div>` that owns the AnimatePresence
  // entrance / exit spring. Combining both transforms on the same
  // element kills the open/close animation (the drag style
  // overrides the animate prop). With the inner-wrapper split the
  // entrance scales/translates the surface from the mini-player
  // origin while the inner wrapper sits at y:0, then drag takes
  // over after the entrance finishes.
  const sheetY = useMotionValue(0);
  // Soft fade and gentle scale-down as the sheet drags down so the
  // dismiss reads as more than just a translation.
  const sheetOpacity = useTransform(sheetY, [0, 240, 480], [1, 0.85, 0.45]);
  const sheetScale = useTransform(sheetY, [0, 480], [1, 0.96]);
  // We use programmatic drag controls so we can route every pointer
  // down on the sheet through one filter: anything that lands on a
  // button, link, input, slider, scrollable panel or the cover (which
  // owns its own horizontal swipe) is excluded; everything else —
  // the header strip, the gaps above/below/around the cover, the
  // empty space between the transport row and the volume slider —
  // grabs the dismiss gesture. That way the user can swipe-down from
  // any "empty" surface to collapse the player, while the controls
  // themselves still behave as plain buttons / sliders.
  const sheetDragControls = useDragControls();
  const SHEET_DRAG_EXCLUDE_SELECTOR =
    'button, a, input, textarea, select, ' +
    '[role="slider"], [role="menu"], [role="menuitem"], ' +
    'video, canvas, [data-no-sheet-drag]';
  // Any foreground panel / modal owns the surface while it's open and
  // takes priority over the parent sheet's dismiss gesture. The user's
  // contract: every modal closes on its own affordance (X button,
  // scrim tap, Esc) and only after the topmost surface is closed does
  // the dismiss-anywhere swipe wake back up. This prevents (a) EQ
  // band-gain strokes / queue reorder pointers double-counting as a
  // dismiss, and (b) accidentally collapsing the player while a queue
  // / add-to-playlist / track-override / kebab menu is open and the
  // user reaches past the dialog scrim onto the player surface.
  //
  // `lyricsOpen` is intentionally NOT in this list: lyrics no longer
  // overlays the player as a separate modal window — on <md it
  // replaces the cover slot, on md+ it slides in as an absolute
  // side-panel. In both cases the user explicitly asked for the
  // swipe-to-dismiss to keep working from the free area outside the
  // lyrics body and outside the player controls. The lyrics body
  // itself opts out of the dismiss gesture via `data-no-sheet-drag`
  // (matched by SHEET_DRAG_EXCLUDE_SELECTOR below) so a wheel /
  // touch-drag inside the lyric verses still scrolls the panel
  // instead of dragging the sheet.
  const anyModalOpen =
    eqOpen ||
    queueOpen ||
    addToPlaylistOpen ||
    overrideOpen ||
    moreOpen;
  const startSheetDrag = (e: React.PointerEvent) => {
    if (reduce) return;
    if (anyModalOpen) return;
    const target = e.target as HTMLElement | null;
    if (target?.closest(SHEET_DRAG_EXCLUDE_SELECTOR)) return;
    sheetDragControls.start(e);
  };

  return (
    <AnimatePresence>
      {fullscreen && currentTrack && (
        <motion.div
          key="fullscreen-player"
          // Mini→fullscreen transition (П12). The mini-player lives at the
          // bottom of the viewport, so we lift the fullscreen surface up
          // from there with a small scale: feels like the same bar
          // expanding into a full sheet rather than a separate page
          // appearing on top. `reduce` users get a plain crossfade.
          initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.96, y: 24 }}
          animate={reduce ? { opacity: 1 } : { opacity: 1, scale: 1, y: 0 }}
          exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.96, y: 24 }}
          transition={{ duration: 0.42, ease: [0.22, 1, 0.36, 1] }}
          className="fullscreen-player fixed inset-0 z-50 flex flex-col overflow-hidden bg-[var(--color-bg)]"
          style={{ transformOrigin: '50% 100%' }}
        >
          {/* Background — restored to the simpler approach the user
              confirmed worked correctly (commit 49360f3). One bg-cover
              blur layer for the cover artwork ambience plus a vertical
              dark gradient that handles readability on bright covers.
              No motion-driven layers, no full-viewport tracking, no
              top/bottom vignettes — those experimental approaches
              consistently introduced visible bands at the edges of
              the viewport. The `blur-3xl` Tailwind preset (≈ 64px)
              + `saturate-150` + `opacity-50` is enough to sample the
              cover's dominant tone without leaking spatial detail.
              The vertical gradient (40 / 60 / 80% black) is the
              "затенящий блюр" the user asked for — sits behind the
              halo and cover, gives white text on a white cover its
              contrast back. */}
          {(trackCoverUrl || coverVideoUrl) && (
            <>
              {/* Ambience layer crossfade (П11) — when the track changes,
                  the blurred backdrop should melt into the new artwork
                  rather than snap. AnimatePresence with `mode="sync"`
                  keeps both layers mounted simultaneously during the
                  transition so we get a real opacity blend. */}
              <AnimatePresence initial={false} mode="sync">
                {coverVideoUrl ? (
                  <motion.video
                    key={coverVideoUrl + '-bg'}
                    src={coverVideoUrl}
                    className="absolute inset-0 -z-10 h-full w-full object-cover blur-3xl saturate-150"
                    initial={reduce ? { opacity: 0.5 } : { opacity: 0 }}
                    animate={{ opacity: 0.5 }}
                    exit={reduce ? { opacity: 0 } : { opacity: 0 }}
                    transition={{ duration: 0.85, ease: [0.4, 0, 0.2, 1] }}
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
                  <motion.div
                    key={(trackCoverUrl ?? '') + '-bg'}
                    className="absolute inset-0 -z-10 bg-cover bg-center blur-3xl saturate-150"
                    style={{ backgroundImage: `url(${trackCoverUrl})` }}
                    initial={reduce ? { opacity: 0.5 } : { opacity: 0 }}
                    animate={{ opacity: 0.5 }}
                    exit={reduce ? { opacity: 0 } : { opacity: 0 }}
                    transition={{ duration: 0.85, ease: [0.4, 0, 0.2, 1] }}
                    aria-hidden
                  />
                )}
              </AnimatePresence>
              {/* Lighter than the original 40/60/80 — the user said
                  the previous gradient darkened the cover too much.
                  This curve still clears the white-on-white case
                  (white cover + white text) but leaves the cover's
                  saturation mostly intact. */}
              <div
                className="absolute inset-0 -z-10 bg-gradient-to-b from-black/15 via-black/30 to-black/50"
                aria-hidden
              />
            </>
          )}

          {/* Inner wrapper — owns the drag-to-dismiss transform so the
              outer AnimatePresence entrance/exit spring keeps working
              independently. `dragListener={false}` keeps motion's own
              pointer listener off; we route every pointer down through
              `startSheetDrag` instead, which filters out interactive
              targets (buttons, sliders, scroll areas, cover) and starts
              the dismiss gesture for everything else. Threshold and
              spring are tuned up: 200 px or 900 px·s velocity to commit
              (was 120/500), with a softer `stiffness:280 damping:24`
              return so a short pull pings back tactilely instead of
              snapping. */}
          <motion.div
            // `fullscreen-drag-zone` pins `touch-action: none` on this
            // wrapper AND forces every descendant to inherit (see
            // `globals.scss`). Without that, default `touch-action:
            // auto` on inner divs lets the browser claim vertical
            // pans as native scroll on any "background" pixel — the
            // user's "swipe works every other time" repro. Sliders
            // (volume / progress / EQ band gain) opt back in to
            // native pans through `[data-allow-pan-y]`; same for the
            // lyrics scroller via the same opt-in.
            className="fullscreen-drag-zone relative flex h-full flex-col"
            drag={reduce ? false : 'y'}
            dragControls={sheetDragControls}
            dragListener={false}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.6 }}
            dragMomentum={false}
            onPointerDown={startSheetDrag}
            onDrag={(_e, info) => {
              if (info.offset.y > 0) sheetY.set(info.offset.y);
            }}
            onDragEnd={(_e, info) => {
              if (info.offset.y > 200 || info.velocity.y > 900) {
                closeFullscreen();
                return;
              }
              animate(sheetY, 0, {
                type: 'spring',
                stiffness: 280,
                damping: 24,
                mass: 0.9,
              });
            }}
            style={{ y: sheetY, opacity: sheetOpacity, scale: sheetScale }}
          >

          <div
            className="relative z-[20] flex items-center justify-between px-5 pb-4"
            // Sheet-dismiss drag is wired on the inner wrapper one
            // level up. The header still listens for pointer events
            // normally so its buttons keep working; empty space
            // inside the header bubbles up to the wrapper's
            // `onPointerDown={startSheetDrag}` and starts the drag.
            //
            // `touchAction: 'none'` is critical: with the previous
            // `pan-y` value the browser claimed every vertical pan as
            // a native scroll attempt and fired `pointercancel` on
            // motion's drag pipeline, which is exactly why the
            // user-reported "свайп сверху вниз по пустому пространству"
            // never fired the dismiss. The body is `overflow:hidden`
            // and the player is a fullscreen modal so there is
            // nowhere for the browser to scroll anyway — letting JS
            // own all gestures here makes the wrapper's `drag='y'`
            // see vertical pan events and run the dismiss reliably.
            //
            // `paddingTop` keeps the original 1rem rhythm (`py-4`) but
            // adds the PWA notch / status-bar inset on top so the
            // close (chevron-down) button isn't hidden behind the
            // iPhone notch when the app is installed. The variable
            // resolves to `0px` in browser tabs so the on-screen
            // position is unchanged outside PWA mode — see
            // `globals.scss` for the `--pwa-safe-top` definition.
            style={{
              touchAction: 'none',
              paddingTop: 'calc(1rem + var(--pwa-safe-top))',
            }}
          >
            <Button variant="ghost" size="icon" onClick={closeFullscreen} aria-label={t('fullscreenPlayer.minimize')}>
              <ChevronDown size={20} />
            </Button>
            {/* `top-0 h-full` made the centred label span the entire
                header box including the parent's `paddingTop:
                calc(1rem + var(--pwa-safe-top))` — so on PWA iOS the
                vertical centre of the label sat above the icon row,
                visibly drifting up relative to the close / kebab
                buttons (which the parent flex centres over the
                content area, BELOW the safe-area inset). Anchoring
                the label between the parent's actual padding edges
                gives it the same vertical band as the icons on every
                platform: paddingTop matches the parent and `bottom`
                mirrors `pb-4`. */}
            <span
              className="pointer-events-none absolute inset-x-0 flex items-center justify-center text-xs font-medium uppercase tracking-[0.25em] text-muted-foreground"
              style={{
                top: 'calc(1rem + var(--pwa-safe-top))',
                bottom: '1rem',
              }}
            >
              {t('fullscreenPlayer.nowPlaying')}
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
                aria-label={t('fullscreenPlayer.startRadio')}
                disabled={radioBusy}
                title={t('fullscreenPlayer.radioTitle')}
                className="hidden md:inline-flex"
              >
                {radioBusy ? <Loader2 size={18} className="animate-spin" /> : <Radio size={18} />}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setQueueOpen(true)}
                aria-label={t('fullscreenPlayer.queue')}
                className="hidden md:inline-flex"
              >
                <ListOrdered size={18} />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setLyricsOpen((v) => !v)}
                aria-label={t('fullscreenPlayer.lyricsTitle')}
                className={(lyricsOpen ? 'text-foreground ' : '') + 'hidden md:inline-flex'}
              >
                <Mic2 size={18} />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setEqOpen((v) => !v)}
                aria-label={t('fullscreenPlayer.eq')}
                className={(eqOpen ? 'text-foreground ' : '') + 'hidden md:inline-flex'}
              >
                <Sliders size={18} />
              </Button>

              {/* Kebab → X-close swap on narrow screens. When lyrics
                  are open in the cover slot (mobile-only redesign), the
                  user-asked-for affordance is for the same top-right
                  control to flip into a close button rather than carry
                  any of the kebab's actions: there's no parallel use
                  for the kebab while reading lyrics, and the only thing
                  the user wants from that corner is "stop showing
                  lyrics". On md+ the kebab stays put because lyrics
                  there is a side-panel with its own dismiss. */}
              <Button
                ref={moreTriggerRef}
                variant="ghost"
                size="icon"
                onClick={
                  lyricsOpen && !isMdUp
                    ? () => setLyricsOpen(false)
                    : () => setMoreOpen((v) => !v)
                }
                aria-label={lyricsOpen && !isMdUp ? t('lyrics.closeAria') : t('track.actions')}
                aria-haspopup={lyricsOpen && !isMdUp ? undefined : 'menu'}
                aria-expanded={lyricsOpen && !isMdUp ? undefined : moreOpen}
              >
                {lyricsOpen && !isMdUp ? <X size={18} /> : <MoreHorizontal size={18} />}
              </Button>
              <PopoverMenu
                open={moreOpen}
                onClose={() => setMoreOpen(false)}
                triggerRef={moreTriggerRef}
                anchor="bottom"
                align="end"
                width={240}
              >
                {moreView === 'artist-hide-picker' ? (
                  <ArtistDislikeMenuItems
                    track={currentTrack}
                    view="artist-picker"
                    onViewChange={(v) => setMoreView(v === 'artist-picker' ? 'artist-hide-picker' : 'main')}
                    onAction={() => setMoreOpen(false)}
                  />
                ) : moreView === 'artist-go-picker' ? (
                  <ArtistGoToMenuItems
                    track={currentTrack}
                    view="artist-go-picker"
                    onViewChange={(v) => setMoreView(v === 'artist-go-picker' ? 'artist-go-picker' : 'main')}
                    onAction={() => setMoreOpen(false)}
                    beforeNavigate={closeFullscreen}
                  />
                ) : (
                  <>
                {/* Mobile-only group: surfaces the four track-side actions
                    that are inline buttons on md+ but collapse here on
                    narrow widths. */}
                <MenuItem
                  mobileOnly
                  onClick={() => { handleStartRadio(); setMoreOpen(false); }}
                  disabled={radioBusy}
                  icon={radioBusy ? <Loader2 size={14} className="animate-spin" /> : <Radio size={14} />}
                >
                  {t('fullscreenPlayer.startRadio')}
                </MenuItem>
                <MenuItem
                  mobileOnly
                  onClick={() => { setQueueOpen(true); setMoreOpen(false); }}
                  icon={<ListOrdered size={14} />}
                >
                  {t('fullscreenPlayer.queue')}
                </MenuItem>
                <MenuItem
                  mobileOnly
                  onClick={() => { setLyricsOpen((v) => !v); setMoreOpen(false); }}
                  icon={<Mic2 size={14} />}
                >
                  {lyricsOpen ? t('fullscreenPlayer.lyricsHide') : t('fullscreenPlayer.lyricsTitle')}
                </MenuItem>
                <MenuItem
                  mobileOnly
                  onClick={() => { setEqOpen((v) => !v); setMoreOpen(false); }}
                  icon={<Sliders size={14} />}
                >
                  {eqOpen ? t('fullscreenPlayer.eqHide') : t('fullscreenPlayer.eq')}
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
                  {t('fullscreenPlayer.shuffleSuffix')}{shuffle ? t('fullscreenPlayer.shuffleOn') : ''}
                </MenuItem>
                <MenuItem
                  mobileOnly
                  onClick={() => { cycleRepeat(); setMoreOpen(false); }}
                  icon={repeat === 'one' ? <Repeat1 size={14} className="text-foreground" /> : <Repeat size={14} className={repeat === 'all' ? 'text-foreground' : ''} />}
                >
                  {t('fullscreenPlayer.repeatLabel')}{repeat === 'all' ? t('fullscreenPlayer.repeatAllSuffix') : repeat === 'one' ? t('fullscreenPlayer.repeatOneSuffix') : ''}
                </MenuItem>
                <MenuDivider mobileOnly />

                {/* Always-shown: track navigation + library actions. Most
                    of these would otherwise require closing the fullscreen
                    player to reach. */}
                <MenuItem
                  onClick={() => { setAddToPlaylistOpen(true); setMoreOpen(false); }}
                  icon={<ListPlus size={14} />}
                >
                  {t('track.addToPlaylist')}
                </MenuItem>
                <ArtistGoToMenuItems
                  track={currentTrack}
                  view="main"
                  onViewChange={(v) => setMoreView(v === 'artist-go-picker' ? 'artist-go-picker' : 'main')}
                  onAction={() => setMoreOpen(false)}
                  beforeNavigate={closeFullscreen}
                />
                {currentTrack.albumId && (
                  <MenuItem
                    onClick={() => { goToAlbum(); setMoreOpen(false); }}
                    icon={<Disc size={14} />}
                  >
                    {t('track.goToAlbum')}
                  </MenuItem>
                )}
                <MenuDivider />
                <MenuItem
                  onClick={handleShare}
                  icon={shareCopied ? <Check size={14} className="text-[var(--color-accent)]" /> : <Share2 size={14} />}
                >
                  {shareCopied ? t('track.shareCopied') : t('track.share')}
                </MenuItem>
                <MenuItem
                  onClick={() => { handleOfflineToggle(); setMoreOpen(false); }}
                  icon={
                    isTrackDownloadingOffline
                      ? (
                          <OfflineProgressIcon
                            progress={trackDownloadJob?.progress ?? null}
                            size={14}
                          />
                        )
                      : trackSavedOffline
                        ? <Check size={14} className="text-[var(--color-accent)]" />
                        : <ArrowDownToLine size={14} />
                  }
                >
                  {isTrackDownloadingOffline
                    ? `${Math.round((trackDownloadJob?.progress ?? 0) * 100)}% · ${t('offline.cancelDownload')}`
                    : trackSavedOffline
                      ? t('offline.removeFromDevice')
                      : t('offline.listenOffline')}
                </MenuItem>
                <MenuItem
                  onClick={() => { handleDownload(); setMoreOpen(false); }}
                  disabled={downloading}
                  icon={downloading ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                >
                  {t('track.download')}
                </MenuItem>
                <MenuItem
                  onClick={() => { setOverrideOpen(true); setMoreOpen(false); }}
                  icon={<Upload size={14} />}
                >
                  {t('track.uploadOwn')}
                </MenuItem>
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
                    <ArtistDislikeMenuItems
                      track={currentTrack}
                      view="main"
                      onViewChange={(v) => setMoreView(v === 'artist-picker' ? 'artist-hide-picker' : 'main')}
                      onAction={() => setMoreOpen(false)}
                    />
                  </>
                )}
                  </>
                )}
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
          {/* (Previously a hidden swipe-down catcher lived here above
              the cover. Now the inner wrapper's `onPointerDown` filter
              picks up pointer-downs anywhere on the empty surface, so
              this dedicated strip is no longer needed.) */}
          <div className="relative z-[3] flex flex-1 min-h-0">
          {/* Cover column. Uses the simple flex layout from commit
              49360f3 — the user explicitly asked for that. The lyrics
              side-panel still pushes the column left by `-22%` on md+
              so the cover visually re-centres in the remaining space
              when lyrics is open (this animation didn't exist in the
              original commit because lyrics didn't exist yet, but the
              layout still works correctly: cover-wrapper width is
              `max-w-md`, so the shift just translates the whole
              column without resizing anything). */}
          <motion.div
            animate={reduce ? undefined : { x: lyricsOpen && isMdUp ? '-22%' : '0%' }}
            transition={{ type: 'spring', stiffness: 240, damping: 32, mass: 0.85 }}
            // `min-h-0` is essential here — inside a parent flex, a
            // flex item's default min-height is `auto` (its content's
            // intrinsic height), which prevents the cover from
            // shrinking to fit the viewport. With `min-h-0` the
            // column can shrink below its intrinsic content height
            // and the cover-wrapper's height-aware maxWidth clamp
            // (see below) can actually take effect.
            //
            // Padding rules:
            //   - Mobile: symmetric `py-4` — the user explicitly said
            //     mobile reads correctly, so we don't touch it.
            //   - Desktop: `sm:pt-6 sm:pb-10` — the user reported the
            //     volume slider visually "fell to the bottom" on wide
            //     screens. Bumping the bottom pad to 40px lifts it
            //     into the visible area while keeping the breathing
            //     gap above the cover (sm:pt-6) symmetric to the
            //     header bar's own `py-4`.
            // `min-w-0 w-full` are essential here. The fullscreen
            // player is `flex flex-col overflow-hidden` and this is
            // its single growing flex item — without `min-w-0` the
            // flex parent refuses to shrink the column below its
            // min-content (driven by the cover wrapper's intrinsic
            // aspect-ratio and the `max-w-md` title/transport rows).
            // On a narrow viewport (≈250–300 px wide DevTools, the
            // user's exact repro) flex would leave the column
            // ~496 px wide while the player itself is clipped to the
            // viewport, so every inner row would slide past the
            // right edge. With `min-w-0 w-full` the column shrinks
            // to fill the narrow player exactly, and the inner
            // `w-full max-w-md` rows resolve to `min(player_width, 28rem)`.
            className="relative flex min-h-0 min-w-0 w-full flex-1 flex-col items-center justify-center gap-6 px-6 py-4 sm:gap-8 sm:pt-6 sm:pb-10"
          >
            {/* Cover artwork wrapper. Width is `w-full max-w-md` so
                on a tall enough viewport it renders at the full
                28rem (448px) the user marked as ideal. The
                viewport-height-aware clamp below shrinks the cover
                when there isn't enough room for the rest of the
                stack — the reserve is sized for the desktop case
                (sm:py-6 + sm:gap-8) which is where the volume
                slider was getting clipped:

                  header 72 + title 56 + progress 30 + transport 56 +
                  volume 40 + 4×gap-8 128 + sm:pt-6 24 + sm:pb-10 40
                  ≈ 446px ≈ 28rem

                We reserve 28rem to match this stack on desktop; the
                remaining slack distributes equally above and below
                via `justify-center`. We add `aspect-square mx-auto` so
                both dimensions of the wrapper shrink together with
                the maxWidth clamp — without it, only width
                shrinks and the TiltCard inside (which derives its
                own size from `aspect-square`) wouldn't follow.

                On narrow viewports the cover slot is conditionally
                replaced by the lyrics body — the user explicitly asked
                for the lyric layer to "замещали обложку" rather than
                overlay the player as a separate window. The lyrics
                block is sized IDENTICALLY to the cover (same
                aspect-square + max-w-md + the same viewport-height
                clamp) — that's a hard constraint from the user: title
                / progress / transport / volume must NOT shift pixels
                when lyrics open. md+ keeps the side-panel layout (see
                desktop side-panel below) so this swap is gated on
                `!isMdUp`. */}
            {lyricsOpen && !isMdUp ? (
              <div
                key="lyrics-cover-slot"
                // OUTER wrapper occupies the EXACT same flow box as
                // the cover (`aspect-square w-full max-w-md` + the
                // identical viewport-height clamp). Keeping this
                // wrapper at the same in-flow dimensions is what
                // anchors the title / progress / transport / volume
                // rows below — they must not shift pixels when
                // lyrics open (hard user constraint).
                //
                // `overflow-visible` lets the absolute INNER wrapper
                // (below) paint upward past the slot's top edge so
                // the lyrics body visually consumes the breathing
                // space above the cover. Without `overflow-visible`,
                // the upward extension is clipped at the slot's top.
                //
                // `data-no-sheet-drag` keeps the parent fullscreen
                // sheet's drag-to-dismiss from grabbing pointer
                // events that originate inside the lyrics body. The
                // `LyricsContent` itself owns `data-allow-pan-y` so
                // the user can scroll through verses with a finger
                // even though the surrounding fullscreen-drag-zone
                // pins `touch-action: none`.
                data-no-sheet-drag
                className="relative mx-auto aspect-square w-full max-w-md overflow-visible"
                style={{ maxWidth: 'min(28rem, calc(100vh - 28rem))' }}
              >
                {/*
                  INNER wrapper extends ~5rem upward past the slot's
                  top edge so the lyrics body fills more of the
                  breathing space the parent `justify-center` leaves
                  between the fullscreen header strip and the cover
                  row, while leaving a small visual gap from the
                  X / kebab icon row above. The bottom edge stays
                  pinned to the slot's bottom (`bottom-0`) so the
                  title row below remains in place. 5rem is the
                  empirically-stable middle ground: on phone-sized
                  viewports (~600px tall) the breathing space above
                  the cover is ~7rem, so a 5rem extension leaves a
                  ~2rem gap from the header; on tablet-sized
                  viewports (~900px) it leaves ~7rem of gap which
                  still reads as comfortable padding.
                */}
                <div
                  className="absolute inset-x-0 bottom-0"
                  style={{ top: '-5rem' }}
                >
                  <LyricsContent trackId={currentTrack.id} onSeek={seek} />
                </div>
              </div>
            ) : (
            <motion.div
              // Outer wrapper keeps a stable position across track changes
              // (П11). Previously this was keyed by `currentTrack.id`, which
              // unmounted-and-remounted the entire halo + TiltCard subtree
              // on every skip — causing the visible "резкая" snap of the
              // cover. We crossfade the cover content INSIDE the TiltCard
              // instead, while the wrapper itself only animates once on
              // first mount.
              //
              // P10 — horizontal drag commits to next/prev. We let the
              // user physically pull the cover sideways (with mild
              // elasticity) instead of just sniffing the gesture, so
              // the swipe has tactile feedback. `dragSnapToOrigin`
              // springs the cover back if the user releases below the
              // commit threshold.
              drag={reduce ? false : 'x'}
              dragConstraints={{ left: 0, right: 0 }}
              dragElastic={0.45}
              dragMomentum={false}
              dragSnapToOrigin
              onDragEnd={(_e, info) => {
                if (info.offset.x < -90 || info.velocity.x < -500) {
                  nextManual();
                } else if (info.offset.x > 90 || info.velocity.x > 500) {
                  // Cover drag is an explicit navigation gesture —
                  // force-skip the 3 s rewind threshold so a swipe
                  // mid-track always lands on the previous song.
                  previous(true);
                }
              }}
              initial={reduce ? false : { opacity: 0, scale: 0.92 }}
              animate={reduce ? undefined : {
                opacity: 1,
                // The cover artwork itself stays perfectly still during
                // playback — the user explicitly does not want the
                // visible image to react to the bass. The bass-driven
                // breathing/halo/blur lives on the sibling halo layer
                // below (`scale: 1.02 + pulse * 0.18 + flash * 0.10`),
                // so the glow continues to pulse with the music while
                // the artwork stays anchored at scale: 1.
                scale: 1,
              }}
              transition={{ type: 'spring', stiffness: 220, damping: 22, mass: 0.5 }}
              className="relative mx-auto aspect-square w-full max-w-md cursor-grab select-none active:cursor-grabbing"
              style={
                {
                  maxWidth: 'min(28rem, calc(100vh - 28rem))',
                  // `touch-action: none` is intentional. The cover
                  // covers the bulk of the fullscreen surface, so
                  // when it claimed vertical pan as native browser
                  // scroll (the previous `pan-y` value, also the
                  // implicit default motion picks for `drag='x'`)
                  // the user's swipe-down dismiss never reached the
                  // parent wrapper — the browser swallowed the
                  // gesture and fired `pointercancel` on motion's
                  // drag pipeline, leaving the player stuck.
                  // Letting JS own every gesture lets the cover keep
                  // its `drag='x'` next/prev navigation while
                  // simultaneously letting the parent's `drag='y'`
                  // capture vertical pans for the dismiss; motion's
                  // per-axis drags coexist because each one ignores
                  // the orthogonal axis.
                  touchAction: 'none',
                  // Suppress the desktop browser's native image-drag
                  // and text-selection so a left-click + drag on the
                  // cover triggers motion's `drag='x'` swipe instead
                  // of starting a "drag image to file" gesture or
                  // highlighting the artwork. Without these, on
                  // desktop Chromium / WebKit the cover would just
                  // get a translucent ghost dragged around with the
                  // cursor and the swipe never fires.
                  WebkitUserSelect: 'none',
                  userSelect: 'none',
                  WebkitUserDrag: 'none',
                } as React.CSSProperties
              }
              onDragStart={(e) => {
                // motion will fire `onDragStart` for its own pointer
                // drag too, but the *native* `dragstart` (image,
                // text selection) bubbles up here as well. Cancel
                // the native one so the cover can't be dragged off
                // the page or selected. Motion's drag pipeline runs
                // off pointer events so it is unaffected.
                if ((e as unknown as DragEvent).dataTransfer) {
                  (e as unknown as DragEvent).preventDefault();
                }
              }}
            >
              {(trackCoverUrl || coverVideoUrl) && (
                <motion.div
                  aria-hidden
                  className="pointer-events-none absolute inset-0 -z-10"
                  animate={reduce ? undefined : {
                    // Halo around the cover — "обложка-дубликат”
                    // bass-driven glow. Wider dynamic range than
                    // before (the user said the previous numbers
                    // looked "в одном положении"): scale breathes
                    // 1.02→1.30 instead of 1.04→1.16, opacity 0.35→0.92,
                    // blur 56→120px. `flash` adds a short brightness +
                    // scale kick on every detected bass transient so
                    // even within a sustained bass line you see the
                    // halo react beat-by-beat.
                    scale: 1.02 + pulse * 0.18 + flash * 0.10,
                    opacity: 0.35 + pulse * 0.45 + flash * 0.20,
                    filter: `blur(${56 + pulse * 64}px) saturate(${1.2 + pulse * 0.5 + flash * 0.4})`,
                  }}
                  transition={{ type: 'spring', stiffness: 110, damping: 20, mass: 0.6 }}
                  style={{
                    // No backgroundImage here — the cover-specific halo
                    // image lives in the inner AnimatePresence layer
                    // below so it can crossfade with the cover. This
                    // outer halo just owns the bass-driven transform.
                    borderRadius: 'var(--radius-xl)',
                  }}
                >
                  <AnimatePresence initial={false} mode="sync">
                    {coverVideoUrl ? (
                      <motion.video
                        key={coverVideoUrl + '-glow'}
                        src={coverVideoUrl}
                        className="absolute inset-0 h-full w-full object-cover pointer-events-none"
                        initial={reduce ? false : { opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={reduce ? { opacity: 0 } : { opacity: 0 }}
                        transition={{ duration: 0.75, ease: [0.4, 0, 0.2, 1] }}
                        autoPlay
                        muted
                        loop
                        playsInline
                        preload="auto"
                        aria-hidden
                        disablePictureInPicture
                        controlsList="nofullscreen nodownload noremoteplayback"
                      />
                    ) : trackCoverUrl ? (
                      <motion.div
                        key={trackCoverUrl + '-glow'}
                        className="absolute inset-0 bg-cover bg-center"
                        style={{ backgroundImage: `url(${trackCoverUrl})`, borderRadius: 'var(--radius-xl)' }}
                        initial={reduce ? false : { opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={reduce ? { opacity: 0 } : { opacity: 0 }}
                        transition={{ duration: 0.75, ease: [0.4, 0, 0.2, 1] }}
                      />
                    ) : null}
                  </AnimatePresence>
                </motion.div>
              )}
              <TiltCard
                intensity={20}
                hoverScale={1.06}
                glareStrength={0.7}
                glare
                // The TiltCard owns a `transform-style: preserve-3d` +
                // perspective context for its rotateX/rotateY tilt. In
                // that context Chromium and WebKit both have edge cases
                // where a sibling that pops in mid-frame (like the new
                // crossfade layer below) can paint a single frame BEFORE
                // the ancestor's `overflow: hidden` clip mask is applied,
                // briefly showing the cover with square corners on track
                // change. Belt-and-suspenders: keep `overflow-hidden` for
                // the static case AND `clip-path: inset(0 round R)` so
                // the rounded clip is enforced even on the first paint
                // frame of any newly inserted compositor layer.
                style={{ clipPath: 'inset(0 round var(--radius-xl))' }}
                className="aspect-square overflow-hidden rounded-[var(--radius-xl)] border border-border shadow-2xl transition-shadow duration-300 hover:shadow-[0_25px_80px_-15px_rgba(0,0,0,0.55)]"
              >
                {/* Inner cover layer crossfades between tracks (П11).
                    AnimatePresence is keyed by track id so a skip
                    fades the previous cover out while the next fades
                    in, in place. TiltCard's inner div is now
                    `relative h-full w-full` so the absolute-positioned
                    crossfade layers below resolve cleanly. */}
                <AnimatePresence initial={false} mode="sync">
                  <motion.div
                    key={currentTrack.id + (coverVideoUrl ? '-v' : '-i')}
                    // Round the crossfade layer itself, not just the
                    // ancestor TiltCard. Both the entering and the
                    // exiting layer keep their own clip mask, so neither
                    // can ever be visible with square corners — the
                    // "скрепления отключаются на долю секунды" issue
                    // the user reported on track change.
                    className="absolute inset-0 overflow-hidden rounded-[inherit]"
                    style={{ clipPath: 'inset(0 round var(--radius-xl))' }}
                    initial={reduce ? false : { opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={reduce ? { opacity: 0 } : { opacity: 0 }}
                    transition={{ duration: 0.75, ease: [0.4, 0, 0.2, 1] }}
                  >
                {coverVideoUrl ? (
                  // Animated cover (Tidal mp4). Falls back gracefully — the
                  // <img> stays under the <video> as a poster so even if
                  // the mp4 fails to load we still see a static cover.
                  //
                  // Round-corner correctness on <video> is *fragile*. The
                  // first paint clips fine via the parent's `overflow:
                  // hidden` + `border-radius`, but as soon as the video
                  // element starts decoding frames the browser promotes
                  // it to a hardware-composited layer that ignores the
                  // ancestor's border-radius clip — the corners visibly
                  // un-round a few moments after playback starts (the
                  // exact behaviour the user reported). The robust fix
                  // is to clip the *video element itself* with both
                  // `clip-path: inset(... round R)` and
                  // `-webkit-mask-image` — both survive compositor
                  // promotion in Chromium and WebKit respectively.
                  <div
                    className="relative h-full w-full overflow-hidden rounded-[inherit]"
                    style={{
                      clipPath: 'inset(0 round var(--radius-xl))',
                    }}
                  >
                    {trackCoverUrl && (
                      <img
                        src={trackCoverUrl}
                        alt={currentTrack.title}
                        // `pointer-events-none` keeps clicks falling
                        // through to the motion drag wrapper above;
                        // `draggable={false}` + `select-none` block
                        // the desktop browser's native image-drag /
                        // text-select that would otherwise hijack a
                        // mouse drag on the cover.
                        className="pointer-events-none absolute inset-0 h-full w-full select-none object-cover"
                        draggable={false}
                      />
                    )}
                    <video
                      key={coverVideoUrl}
                      src={coverVideoUrl}
                      poster={trackCoverUrl}
                      className="relative z-[1] h-full w-full object-cover"
                      style={{
                        borderRadius: 'var(--radius-xl)',
                        clipPath: 'inset(0 round var(--radius-xl))',
                        // The WebKit mask hack — forces Safari to keep the
                        // composited video layer clipped to its own
                        // border-radius. The radial gradient is fully
                        // opaque so it has no visible effect; only the
                        // mask layer's existence matters.
                        WebkitMaskImage:
                          '-webkit-radial-gradient(white, black)',
                      }}
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
                ) : trackCoverUrl ? (
                  <img
                    src={trackCoverUrl}
                    alt={currentTrack.title}
                    // See above: keep the cover unable to be dragged
                    // or text-selected so the parent motion wrapper
                    // wins the desktop pointer-drag swipe.
                    className="pointer-events-none absolute inset-0 h-full w-full select-none object-cover"
                    draggable={false}
                  />
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center bg-secondary text-muted-foreground">
                    {t('fullscreenPlayer.noCover')}
                  </div>
                )}
                  </motion.div>
                </AnimatePresence>
              </TiltCard>
            </motion.div>
            )}

            {/* Title row. Important: NO `overflow-hidden` and an
                explicit `shrink-0` here. The fullscreen layout puts
                this row inside a `flex-col flex-1 min-h-0` parent, so
                without `shrink-0` flexbox happily compresses the row
                BELOW its natural line-height when the cover above
                takes most of the viewport — which clips the entire
                top half of the artist text the way the user reported
                in the >640px screenshot. Horizontal long-name
                clipping is owned by each `<Marquee>` child via its
                own clip-path, so we don't need overflow-hidden here. */}
            <div className="flex w-full max-w-md min-w-0 shrink-0 items-center gap-2">
              <Button
                variant="ghost"
                size="icon"
                aria-label={t('track.addToPlaylist')}
                onClick={() => currentTrack && setAddToPlaylistOpen(true)}
                className="shrink-0 h-10 w-10 text-muted-foreground hover:text-foreground"
              >
                <ListPlus size={20} />
              </Button>

              {/* Title/artist column. `flex-1 basis-0 min-w-0` makes
                  the column width derive purely from leftover space
                  after the fixed-size ListPlus + Heart buttons (so a
                  long title can never push Heart off the right edge,
                  which is the bug the user reported on mobile fullscreen).
                  No `overflow-hidden` on this column — horizontal
                  clipping is already enforced by each `<Marquee>`
                  child via its own clip-path, and overflow-hidden on
                  the column would re-introduce vertical clipping of
                  the line-box (Cyrillic ascenders/descenders, latin
                  `y`/`g`/`j`). */}
              <div className="flex flex-1 basis-0 min-w-0 flex-col items-stretch gap-1">
                <motion.div
                  key={currentTrack.id + '-title'}
                  initial={reduce ? false : { opacity: 0, y: 8 }}
                  animate={reduce ? undefined : { opacity: 1, y: 0 }}
                  transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
                  className="block w-full min-w-0 text-center"
                >
                  <h1 className="flex w-full min-w-0 items-center justify-center gap-2 text-xl font-semibold tracking-tight sm:text-3xl">
                    <span className="block min-w-0 flex-1">
                      <Marquee text={currentTrack.title} />
                    </span>
                    <ExplicitBadge explicit={currentTrack.explicit} size={18} tone="light" />
                  </h1>
                </motion.div>
                {/* Always render the artist line inside a `block w-full
                    text-center` shell so short and long names sit at
                    the same horizontal centre as the title above —
                    previously the no-artistId branch let the Marquee
                    inherit the parent flex column's `items-stretch`
                    default and the text drifted to the left edge. */}
                {hasMultiCredit(currentTrack.artists, currentTrack.artist) ? (
                  <div className="block w-full text-center text-sm text-muted-foreground sm:text-base">
                    <Marquee contentKey={currentTrack.id + ':artists'}>
                      <ArtistLinks
                        nowrap
                        artists={currentTrack.artists}
                        fallbackName={currentTrack.artist}
                        fallbackId={currentTrack.artistId}
                        className="hover:text-foreground hover:underline"
                        // Without this hook the fullscreen overlay
                        // stayed mounted on top of the freshly-loaded
                        // artist page (the user reported the click
                        // "didn't work" on mobile because the URL
                        // changed but no visible transition fired —
                        // the fullscreen sheet at z-50 hid the artist
                        // page underneath until manually dismissed).
                        // Mirrors the single-credit `goToArtist`
                        // button which already calls closeFullscreen
                        // before navigate().
                        onNavigate={closeFullscreen}
                      />
                    </Marquee>
                  </div>
                ) : currentTrack.artistId ? (
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
              </div>

              <Button
                variant="ghost"
                size="icon"
                aria-label={liked ? t('player.unlike') : t('player.like')}
                onClick={() => currentTrack && toggle(currentTrack)}
                className={'shrink-0 h-10 w-10 ' + (liked ? 'text-foreground' : 'text-muted-foreground hover:text-foreground')}
              >
                <Heart size={20} fill={liked ? 'currentColor' : 'none'} />
              </Button>
            </div>

            <div className="flex w-full max-w-md flex-col gap-2">
              <div
                role="slider"
                aria-label={t('player.seek')}
                aria-valuemin={0}
                aria-valuemax={duration || 0}
                aria-valuenow={progress || 0}
                tabIndex={-1}
                data-no-sheet-drag
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
                <div className="relative h-1 w-full overflow-hidden rounded-full bg-white/15">
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
                  className="pointer-events-none absolute top-1/2 z-10 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_2px_8px_rgba(0,0,0,0.5)]"
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
              <Button variant="ghost" size="icon" onClick={toggleShuffle} aria-label={t('player.shuffle')}>
                <Shuffle size={18} className={shuffle ? 'text-foreground' : 'text-muted-foreground'} />
              </Button>
              <Button variant="ghost" size="icon" onClick={() => previous()} aria-label={t('fullscreenPlayer.back')} className="h-12 w-12">
                {/* `fill='currentColor'` paints the triangle interior
                    so the icon reads as solid next to the play/pause
                    glyph; the default stroke keeps the rounded line
                    caps + the vertical bar (lucide's `<line>` element
                    has zero area, so zeroing the stroke would erase
                    the bar entirely). */}
                <SkipBack size={22} fill="currentColor" />
              </Button>
              <motion.div whileTap={reduce ? undefined : { scale: 0.92 }}>
                <Button onClick={togglePlay} className="h-16 w-16 rounded-full" aria-label={isPlaying ? t('player.pause') : t('player.play')}>
                  {isPlaying ? <Pause size={24} fill="currentColor" strokeWidth={0} /> : <Play size={24} fill="currentColor" />}
                </Button>
              </motion.div>
              <Button variant="ghost" size="icon" onClick={nextManual} aria-label={t('fullscreenPlayer.forward')} className="h-12 w-12">
                <SkipForward size={22} fill="currentColor" />
              </Button>
              <Button variant="ghost" size="icon" onClick={cycleRepeat} aria-label={t('player.repeat')}>
                {repeat === 'one' ? (
                  <Repeat1 size={18} className="text-foreground" />
                ) : (
                  <Repeat size={18} className={repeat === 'all' ? 'text-foreground' : 'text-muted-foreground'} />
                )}
              </Button>
            </div>

            {!touchOnly && (
              <div className="flex w-full max-w-md items-center gap-3">
                <Button variant="ghost" size="icon" onClick={toggleMute} aria-label={t('player.mute')}>
                  {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
                </Button>
                {/* Custom volume slider — same look & thickness as the
                    progress bar above (h-1 default, h-1.5 on hover/drag,
                    same 3px round thumb). Native <input type=range> couldn't
                    match the rail thickness reliably across browsers. */}
                <div
                  className="group/volume relative flex h-6 flex-1 cursor-pointer touch-none items-center select-none"
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
                  <div className="relative h-1 w-full rounded-full bg-white/15">
                    {/* No CSS transition on width here — the fill MUST
                        track the cursor in the same frame as the
                        pointermove event that updates `volume`. The
                        previous `transition-[width] duration-100`
                        made the bar trail the cursor by ~100ms during
                        drag, which read as the slider being "laggy"
                        compared to the mini-player slider where the
                        same transition had already been removed. */}
                    <div
                      className="h-full rounded-full bg-white/85"
                      style={{ width: `${(muted ? 0 : volume) * 100}%` }}
                    />
                    <div
                      className="pointer-events-none absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_2px_8px_rgba(0,0,0,0.5)]"
                      style={{ left: `${(muted ? 0 : volume) * 100}%` }}
                    />
                  </div>
                </div>
              </div>
            )}
          </motion.div>

          {/* Desktop side-panel: positioned absolutely over the right
              portion of the row (md:w-[44%] etc.) so the cover column
              never has to animate its width. It slides in from the
              right via the LyricsPanel's own enter/exit animation,
              while the cover translates left by `-22%` (motion.div
              above) to visually re-centre in the remaining space. */}
          {currentTrack && (
            <div
              data-no-sheet-drag
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

          {/* Mobile lyrics: rendered inline as a cover-slot replacement
              (see the `lyricsOpen && !isMdUp` branch above) instead of
              the previous full-surface overlay. The user explicitly
              asked for lyrics to "замещали обложку и пространство
              сверху чуть" rather than cover the entire player as a
              separate window — the overlay path is intentionally
              dropped here. md+ still uses the absolute-positioned
              side-panel above (LyricsPanel mode="side"). */}

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
                {/* Soft scrim — reuse the same `liquid-glass-scrim`
                    backdrop the QueueDialog / AddToPlaylistDialog
                    use, so layered modals share a consistent dim
                    + slight backdrop-blur language. */}
                <motion.div
                  key="eq-backdrop"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
                  onClick={() => setEqOpen(false)}
                  className="liquid-glass-scrim absolute inset-0 z-[5]"
                  aria-hidden
                />
                {/* `data-no-sheet-drag` keeps the parent fullscreen
                    sheet's drag-to-dismiss from grabbing pointer events
                    that originate inside the EQ canvas (band nodes,
                    curve sweep) — the canvas itself also stops
                    propagation, this is the belt-and-braces opt-out
                    via the selector exclusion list in
                    `startSheetDrag`. */}
                <motion.div
                  key="eq-panel"
                  initial={{ y: 80, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  exit={{ y: 80, opacity: 0 }}
                  transition={{ delay: 0.06, duration: 0.42, ease: [0.16, 1, 0.3, 1] }}
                  className="absolute inset-x-0 bottom-0 z-10 mx-auto flex max-h-[88dvh] w-full max-w-3xl items-end justify-center p-3 sm:p-5"
                  data-no-sheet-drag
                  onPointerDown={(e) => e.stopPropagation()}
                >
                  <Equalizer onClose={() => setEqOpen(false)} />
                </motion.div>
              </>
            )}
          </AnimatePresence>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
