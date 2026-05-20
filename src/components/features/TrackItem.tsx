import { useState } from 'react';
import { Pause, Play, Ban } from 'lucide-react';
import { motion } from 'motion/react';
import type { Track } from '@/types';
import { useTrackPlayback, useTrackHoverPrefetch } from '@/hooks/usePlaybackSync';
import { useIsTrackBanned } from '@/hooks/useDislikedTrack';
import { useOfflineCoverUrl } from '@/hooks/useOfflineCoverUrl';
import { ArtistLinks } from '@/components/features/ArtistLinks';
import { TrackInlineActions } from '@/components/features/TrackInlineActions';
import { OfflineBadge } from '@/components/features/OfflineBadge';
import { ExplicitBadge } from '@/components/features/ExplicitBadge';
import { useT } from '@/i18n';

interface TrackItemProps {
  track: Track;
  index?: number;
  onPlay?: (track: Track) => void;
  /** When set, renders an action menu with "Удалить из плейлиста" */
  playlistId?: string;
  /** When true, the action menu is suppressed (the heart already removes the track). */
  hideRemoveMenu?: boolean;
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function TrackItem({ track, index, onPlay, playlistId, hideRemoveMenu }: TrackItemProps) {
  const t = useT();
  // Pinned-visible flag for the right-hand action row while the kebab
  // popover is open. The popover lives in a body portal so the row's
  // `focus-within` selector can't pick it up.
  const [menuOpen, setMenuOpen] = useState(false);
  // Pointer-hover state mirrored into React so motion's
  // `AnimatePresence` can drive the heart-slides-left + kebab-fades-in
  // reveal. CSS group-hover alone wouldn't be enough — we need a
  // boolean flag to swap conditional children for AnimatePresence.
  const [hovered, setHovered] = useState(false);
  // True when *this* row is the currently-loaded track. Used to swap
  // the cover-overlay icon (Play↔Pause) and to route clicks through
  // togglePlay() instead of restarting the track from zero. Resuming
  // from a paused-but-active state is the expected behaviour everywhere
  // in the app, not just on the active row, so we use `isActive` (not
  // `isActivePlaying`) as the toggle gate.
  const { isActive, isActivePlaying, playOrToggle } = useTrackPlayback(track.id);
  const hoverPrefetch = useTrackHoverPrefetch();
  // Dim the row when the track or one of its artists is on the user's
  // banned list. The row stays interactive (single-tap is still
  // allowed — that's an explicit override, see store/player.ts) but
  // the visual weight drops so disliked items recede in long lists.
  const banned = useIsTrackBanned(track);
  // Prefer the locally-stored cover blob when the track is saved
  // offline so the row keeps painting real artwork even when the
  // device is offline (otherwise the network URL fails and the
  // browser falls back to its broken-image glyph). Falls back to
  // the network `track.coverUrl` for non-saved tracks.
  const coverUrl = useOfflineCoverUrl('track', track.id, track.coverUrl);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: banned && !isActive ? 0.45 : 1, y: 0 }}
      whileHover={banned && !isActive ? { opacity: 1 } : undefined}
      exit={{ opacity: 0, y: -6, transition: { duration: 0.18 } }}
      transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1], delay: Math.min((index ?? 0) * 0.025, 0.4) }}
      className={
        'group flex cursor-pointer items-center gap-3 border-b border-border px-3 py-2 last:border-b-0 transition-colors hover:bg-secondary ' +
        (banned && !isActive ? 'saturate-50' : '')
      }
      onPointerEnter={() => {
        hoverPrefetch(track);
        setHovered(true);
      }}
      onPointerLeave={() => setHovered(false)}
      onClick={() => {
        // Active row → toggle play/pause (whether currently playing or
        // paused). Inactive row → owner's onPlay callback wires up the
        // surrounding queue. This keeps the row consistent with the
        // mini-player and fullscreen play buttons everywhere else.
        if (isActive) {
          playOrToggle(track);
          return;
        }
        onPlay?.(track);
      }}
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center">
        {coverUrl ? (
          <div className="relative h-10 w-10 overflow-hidden rounded-[var(--radius-sm)]">
            <img src={coverUrl} alt="" className="h-full w-full object-cover" />
            {/* Hover overlay. Shows a Pause icon when this row is the
                currently-playing track (signals "click to stop"), or a
                Play icon when starting a new track. The active row
                also pre-shows the overlay (no hover required) on
                coarse-pointer / mobile so users can see playback state
                without hovering. */}
            <div
              className={
                'absolute inset-0 items-center justify-center bg-[var(--color-media-overlay)] ' +
                (isActive
                  ? 'flex opacity-100'
                  : 'hidden group-hover:flex')
              }
            >
              {isActivePlaying ? (
                <Pause size={14} fill="currentColor" className="text-[var(--color-text-on-accent)]" />
              ) : (
                <Play size={14} fill="currentColor" className="text-[var(--color-text-on-accent)]" />
              )}
            </div>
          </div>
        ) : (
          <span className="text-xs tabular-nums text-muted-foreground">
            {index !== undefined ? String(index + 1).padStart(2, '0') : '–'}
          </span>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-0.5 truncate text-sm font-medium">
          {banned && (
            <span
              className="inline-flex h-4 w-4 shrink-0 items-center justify-center text-muted-foreground/70"
              title={t('track.bannedHint')}
              aria-label={t('track.bannedHint')}
            >
              <Ban size={12} />
            </span>
          )}
          <span className="truncate">{track.title}</span>
          <ExplicitBadge explicit={track.explicit} size={12} />
          <OfflineBadge trackId={track.id} size={14} />
        </p>
        <p className="truncate text-xs text-muted-foreground">
          <ArtistLinks
            artists={track.artists}
            fallbackName={track.artist}
            fallbackId={track.artistId}
            className="hover:text-foreground hover:underline"
          />
        </p>
      </div>

      <span className="hidden shrink-0 text-xs tabular-nums text-muted-foreground sm:block">
        {formatDuration(track.duration)}
      </span>

      <TrackInlineActions
        track={track}
        hovered={hovered}
        menuOpen={menuOpen}
        onMenuOpenChange={setMenuOpen}
        playlistId={playlistId}
        hideRemoveFromPlaylistMenu={hideRemoveMenu}
      />
    </motion.div>
  );
}
