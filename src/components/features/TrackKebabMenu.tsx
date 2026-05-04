import { useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Ban, Check, Disc, Download, ListOrdered, ListPlus, Loader2,
  MoreHorizontal, Radio, RotateCcw, Share2, Trash2, Upload, User as UserIcon,
} from 'lucide-react';
import type { Track } from '@/types';
import { Button } from '@/components/ui/Button';
import { PopoverMenu, MenuItem, MenuDivider } from '@/components/ui/PopoverMenu';
import { AddToPlaylistDialog } from '@/components/features/AddToPlaylistDialog';
import { TrackOverrideModal } from '@/components/features/TrackOverrideModal';
import { ArtistDislikeMenuItems } from '@/components/features/ArtistDislikeMenuItems';
import { useAuthStore } from '@/store/auth';
import { usePlayerStore } from '@/store/player';
import { useDislikesStore } from '@/store/dislikes';
import { useToggleDislike } from '@/hooks/useDislikes';
import { useRemoveTrackFromPlaylist } from '@/hooks/useLibrary';
import { startTrackRadio } from '@/lib/trackRadio';
import { downloadTrack, buildTrackShareUrl, copyToClipboard } from '@/lib/trackActions';
import { toast } from '@/store/toast';
import { useT } from '@/i18n';

/**
 * Single source of truth for the per-track context menu used everywhere
 * tracks render — search/album/library `TrackItem`, `PlaylistTrackItem`,
 * mini-`Player`, `FullscreenPlayer`. Before this existed, each surface
 * shipped its own subset (the row item only had add-to-queue/playlist;
 * the player only had share/radio/download/upload; the fullscreen player
 * had a third combination), so the same kebab affordance produced three
 * visibly different action lists depending on where you opened it.
 *
 * The component owns:
 *   - the trigger `<Button>` and its `<MoreHorizontal>` icon,
 *   - the `<PopoverMenu>` and all menu rows,
 *   - the dialogs that the menu can open (`AddToPlaylistDialog`,
 *     `TrackOverrideModal`),
 *   - all per-action busy/copied state (download, radio, share-copied).
 *
 * Callers can splice surface-specific rows above the standard list via
 * the `header` slot — used by `Player` to surface mobile-only
 * Shuffle/Repeat/Queue items, and by `FullscreenPlayer` for
 * Lyrics/EQ/Queue toggles. Those rows render inside the same popover so
 * keyboard navigation and outside-click handling stay consistent.
 */
interface TrackKebabMenuProps {
  track: Track;
  /**
   * When set, the menu adds a destructive "Remove from playlist" row.
   * Hidden when the playlist itself is the system "Liked" playlist
   * (`hideRemoveFromPlaylist`) because un-liking already removes the
   * track and we don't want two affordances doing the same thing.
   */
  playlistId?: string;
  hideRemoveFromPlaylist?: boolean;
  /** Optional header slot — surface-specific rows rendered above the
   *  standard track-action list, separated by a divider. Used by the
   *  player surfaces to keep their session-level toggles colocated
   *  with the per-track actions. */
  header?: ReactNode;
  /** Tweaks the underlying `<PopoverMenu>` placement. The mini-player
   *  needs `anchor="top"` so the menu opens upwards from the bottom-fixed
   *  player surface. */
  anchor?: 'top' | 'bottom';
  align?: 'start' | 'end';
  /** Trigger button size. Track rows use the compact 28×28 variant; the
   *  player surfaces use the default 36×36 to match their other icon
   *  buttons. */
  triggerSize?: 'compact' | 'default';
  /** Optional class overrides on the trigger button. */
  triggerClassName?: string;
  /** Pixel width of the popover. Defaults to 224 to fit the longest
   *  Russian label without truncating. */
  width?: number;
  /** Notifies the parent when the popover open-state changes — used by
   *  `TrackItem` to keep the row's hover-only action bar pinned visible
   *  while the menu is open. The popover itself lives in a body portal,
   *  so the row's `focus-within` selector can't see it. */
  onOpenChange?: (open: boolean) => void;
}

export function TrackKebabMenu({
  track,
  playlistId,
  hideRemoveFromPlaylist,
  header,
  anchor = 'bottom',
  align = 'end',
  triggerSize = 'compact',
  triggerClassName,
  width = 224,
  onOpenChange,
}: TrackKebabMenuProps) {
  const t = useT();
  const navigate = useNavigate();
  const isAuthed = useAuthStore((s) => Boolean(s.user));

  const addToQueue = usePlayerStore((s) => s.addToQueue);
  const playNext = usePlayerStore((s) => s.playNext);

  const trackDisliked = useDislikesStore((s) => s.tracks.has(track.id));
  const toggleDislike = useToggleDislike();

  const removeFromPlaylist = useRemoveTrackFromPlaylist();

  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [open, setOpenState] = useState(false);
  const setOpen = (next: boolean | ((v: boolean) => boolean)) => {
    setOpenState((prev) => {
      const value = typeof next === 'function' ? (next as (v: boolean) => boolean)(prev) : next;
      onOpenChange?.(value);
      return value;
    });
  };
  const [downloading, setDownloading] = useState(false);
  const [radioBusy, setRadioBusy] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [addToPlaylistOpen, setAddToPlaylistOpen] = useState(false);

  const close = () => setOpen(false);

  const handlePlayNext = () => {
    playNext(track);
    close();
  };

  const handleAddToQueue = () => {
    addToQueue(track);
    close();
  };

  const handleAddToPlaylist = () => {
    setAddToPlaylistOpen(true);
    close();
  };

  const handleStartRadio = async () => {
    if (radioBusy) return;
    setRadioBusy(true);
    try {
      await startTrackRadio({
        id: track.id,
        title: track.title,
        artist: track.artist,
        artistId: track.artistId ?? '',
        album: track.album ?? '',
        albumId: track.albumId ?? '',
        duration: track.duration,
        coverUrl: track.coverUrl,
      });
      close();
    } catch (err) {
      console.error('[track-radio]', err);
    } finally {
      setRadioBusy(false);
    }
  };

  const handleShare = async () => {
    const url = buildTrackShareUrl(track.id);
    const ok = await copyToClipboard(url);
    if (ok) {
      setShareCopied(true);
      window.setTimeout(() => setShareCopied(false), 1500);
      // Keep the menu open briefly so the confirmation is visible.
      window.setTimeout(close, 900);
    } else {
      window.prompt(t('track.copyPrompt'), url);
      close();
    }
  };

  const handleDownload = async () => {
    if (downloading) return;
    setDownloading(true);
    try {
      await downloadTrack(track);
    } catch (err) {
      console.error('[download]', err);
    } finally {
      setDownloading(false);
      close();
    }
  };

  const handleOpenOverride = () => {
    setOverrideOpen(true);
    close();
  };

  const handleGoToArtist = () => {
    if (!track.artistId) return;
    navigate(`/artist/${track.artistId}`);
    close();
  };

  const handleGoToAlbum = () => {
    if (!track.albumId) return;
    navigate(`/album/${track.albumId}`);
    close();
  };

  const handleToggleTrackDislike = () => {
    const wasDisliked = trackDisliked;
    toggleDislike.mutate(
      { kind: 'track', id: track.id, source: track.source ?? 'tidal', nextState: wasDisliked ? 'unbanned' : 'banned' },
      {
        onSuccess: () => {
          toast.info(wasDisliked ? t('dislike.trackRestored') : t('dislike.trackHidden', { title: track.title }));
        },
        onError: (err) => {
          toast.error(err instanceof Error ? err.message : t('dislike.failed'));
        },
      },
    );
    close();
  };

  const handleRemoveFromPlaylist = () => {
    if (!playlistId) return;
    removeFromPlaylist.mutate({ playlistId, trackId: track.id });
    close();
  };

  const sizeClass = triggerSize === 'compact' ? 'h-7 w-7' : '';
  const iconSize = triggerSize === 'compact' ? 14 : 16;
  const showRemove = Boolean(playlistId) && !hideRemoveFromPlaylist;

  return (
    <>
      <Button
        ref={triggerRef}
        variant="ghost"
        size="icon"
        className={[sizeClass, triggerClassName].filter(Boolean).join(' ')}
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        aria-label={t('track.actions')}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <MoreHorizontal size={iconSize} />
      </Button>
      <PopoverMenu
        open={open}
        onClose={close}
        triggerRef={triggerRef}
        anchor={anchor}
        align={align}
        width={width}
      >
        {header && (
          <>
            {header}
            <MenuDivider />
          </>
        )}

        {isAuthed && (
          <MenuItem onClick={handleAddToPlaylist} icon={<ListPlus size={14} />}>
            {t('track.addToPlaylist')}
          </MenuItem>
        )}
        <MenuItem onClick={handlePlayNext} icon={<ListOrdered size={14} />}>
          {t('track.playNext')}
        </MenuItem>
        <MenuItem onClick={handleAddToQueue} icon={<ListOrdered size={14} />}>
          {t('track.addToQueue')}
        </MenuItem>
        <MenuItem
          onClick={handleStartRadio}
          disabled={radioBusy}
          icon={radioBusy ? <Loader2 size={14} className="animate-spin" /> : <Radio size={14} />}
        >
          {t('track.startRadio')}
        </MenuItem>

        <MenuDivider />

        <MenuItem
          onClick={handleShare}
          icon={shareCopied ? <Check size={14} className="text-[var(--color-accent)]" /> : <Share2 size={14} />}
        >
          {shareCopied ? t('track.shareCopied') : t('track.share')}
        </MenuItem>
        <MenuItem
          onClick={handleDownload}
          disabled={downloading}
          icon={downloading ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
        >
          {t('track.download')}
        </MenuItem>
        {isAuthed && (
          <MenuItem onClick={handleOpenOverride} icon={<Upload size={14} />}>
            {t('track.uploadOwn')}
          </MenuItem>
        )}

        {(track.artistId || track.albumId) && <MenuDivider />}
        {track.artistId && (
          <MenuItem onClick={handleGoToArtist} icon={<UserIcon size={14} />}>
            {t('track.goToArtist')}
          </MenuItem>
        )}
        {track.albumId && (
          <MenuItem onClick={handleGoToAlbum} icon={<Disc size={14} />}>
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
            <ArtistDislikeMenuItems track={track} onAction={close} />
          </>
        )}

        {showRemove && (
          <>
            <MenuDivider />
            <MenuItem
              onClick={handleRemoveFromPlaylist}
              disabled={removeFromPlaylist.isPending}
              icon={<Trash2 size={14} className="text-[var(--color-danger)]" />}
              className="text-[var(--color-danger)] hover:bg-[var(--color-danger-muted)]"
            >
              {t('track.removeFromPlaylist')}
            </MenuItem>
          </>
        )}
      </PopoverMenu>

      <TrackOverrideModal
        open={overrideOpen}
        onClose={() => setOverrideOpen(false)}
        trackId={track.id}
        trackTitle={t('track.trackTitleByArtist', { artist: track.artist, title: track.title })}
      />

      <AddToPlaylistDialog
        open={addToPlaylistOpen}
        onClose={() => setAddToPlaylistOpen(false)}
        track={track}
      />
    </>
  );
}
