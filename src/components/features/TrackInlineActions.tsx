import { Heart } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import type { Track } from '@/types';
import { Button } from '@/components/ui/Button';
import { useToggleLike } from '@/hooks/useLibrary';
import { useAuthStore } from '@/store/auth';
import { useCoarsePointer } from '@/hooks/useCoarsePointer';
import { TrackKebabMenu } from '@/components/features/TrackKebabMenu';
import { useT } from '@/i18n';

/**
 * Right-hand action cluster used by every track row (`TrackItem`,
 * `PlaylistTrackItem`). Two states:
 *
 *   - **Coarse pointer (mobile, tablet)** — heart and kebab are both
 *     pinned visible. Touch devices have no hover, so action affordances
 *     have to be discoverable at rest.
 *   - **Fine pointer (desktop)** — at rest the row shows only the heart
 *     when the track is liked (visual confirmation of "this is in your
 *     library") and nothing otherwise. On hover or when the kebab
 *     popover is open, the heart slides left and the kebab fades in
 *     from the right edge. The slide-and-fade is driven by `motion`'s
 *     `layout` prop and `AnimatePresence`, so the transition is
 *     genuinely physical (the heart's new position is computed from
 *     flex layout, not from a hard-coded offset, and stays correct as
 *     siblings or content widths change).
 *
 * The download / upload-override actions used to live inline alongside
 * the heart, but they're already in the kebab menu, so duplicating
 * them just made the row noisier without adding anything users
 * couldn't already do.
 */
interface TrackInlineActionsProps {
  track: Track;
  /** True while the parent row is being pointer-hovered. Drives the
   *  desktop reveal animation. Ignored on coarse-pointer devices. */
  hovered: boolean;
  /** Forwarded to `TrackKebabMenu` so the parent can keep the inline
   *  actions pinned visible while the menu's body-portal popover is
   *  open (focus-within can't see across the portal). */
  onMenuOpenChange: (open: boolean) => void;
  /** True while the kebab popover is open. Same reason as above —
   *  needed to override the hover-only reveal. */
  menuOpen: boolean;
  /** Surfaced to `TrackKebabMenu`'s "Remove from playlist" item. */
  playlistId?: string;
  hideRemoveFromPlaylistMenu?: boolean;
}

export function TrackInlineActions({
  track,
  hovered,
  onMenuOpenChange,
  menuOpen,
  playlistId,
  hideRemoveFromPlaylistMenu,
}: TrackInlineActionsProps) {
  const t = useT();
  const isAuthed = useAuthStore((s) => Boolean(s.user));
  const { isLiked, toggle } = useToggleLike();
  const liked = isAuthed && isLiked(track.id);
  const coarse = useCoarsePointer();

  // Heart visibility:
  //   - coarse: always (touch UI needs persistent affordances)
  //   - liked: always (signals "in library" at rest)
  //   - hovered or menuOpen: also visible so the user can un-like
  //     without having to like first
  const showHeart = coarse || liked || hovered || menuOpen;
  // Kebab visibility:
  //   - coarse: always
  //   - hovered or menuOpen: shown so the user can drill into the
  //     extended action set (download, upload override, share, radio,
  //     queue, dislike). Hidden at rest on desktop to keep the row
  //     visually quiet — the user gets there with hover, and the kebab
  //     stays anchored once the menu is open.
  const showKebab = coarse || hovered || menuOpen;

  // Heart's `layout` prop animates its x-position smoothly when the
  // kebab enters / exits the flex track to its right. The min-width
  // prevents the duration column from jumping when both icons leave on
  // mouse-out — without it, the row reflows by a few pixels and the
  // text shifts, which reads as a layout glitch.
  return (
    <div className="flex min-w-[32px] items-center justify-end gap-0.5">
      <AnimatePresence initial={false} mode="popLayout">
        {showHeart && (
          <motion.div
            key="heart"
            layout
            initial={{ opacity: 0, scale: 0.85 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.85 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
          >
            <Button
              variant="ghost"
              size="icon"
              className={'h-7 w-7 ' + (liked ? 'text-[var(--color-accent)]' : '')}
              onClick={(e) => {
                e.stopPropagation();
                if (isAuthed) toggle(track);
              }}
              aria-label={liked ? t('player.unlike') : t('player.like')}
            >
              <Heart size={14} fill={liked ? 'currentColor' : 'none'} />
            </Button>
          </motion.div>
        )}
        {showKebab && (
          <motion.div
            key="kebab"
            layout
            initial={{ opacity: 0, x: 8 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 8 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
          >
            <TrackKebabMenu
              track={track}
              playlistId={playlistId}
              hideRemoveFromPlaylist={hideRemoveFromPlaylistMenu}
              onOpenChange={onMenuOpenChange}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
