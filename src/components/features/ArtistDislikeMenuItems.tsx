import { useMemo, useRef, useState, type RefObject } from 'react';
import { ArrowLeft, Ban, ChevronRight, RotateCcw, UserMinus } from 'lucide-react';
import { MenuDivider, MenuItem, PopoverMenu } from '@/components/ui/PopoverMenu';
import type { ArtistRef, Track } from '@/types';
import { useDislikesStore } from '@/store/dislikes';
import { useToggleDislike } from '@/hooks/useDislikes';
import { toast } from '@/store/toast';
import { useT } from '@/i18n';

interface Props {
  track: Track;
  /**
   * Anchor for the artist-picker sub-popover used on multi-artist
   * tracks. Should be the same kebab button element that opened the
   * parent popover so the sub-menu visually replaces the parent
   * menu in place when the user drills in. Required only for
   * multi-artist tracks; single-artist tracks render an inline row
   * and ignore this ref.
   */
  triggerRef?: RefObject<HTMLElement | null>;
  /** Anchor side that matches the parent kebab — keeps the sub-menu
   *  flowing in the same direction as the originating menu. */
  anchor?: 'top' | 'bottom';
  align?: 'start' | 'end';
  /** Called after a dislike toggle fires — parents use this to close the
   *  hosting popover so the menu collapses on the same tick the toast
   *  appears. For multi-artist tracks the picker manages its own
   *  open state; this fires once the user has actually picked an
   *  artist (or after the parent should close to make room for the
   *  sub-popover). */
  onAction?: () => void;
}

/**
 * Shared menu fragment that exposes the per-artist hide / restore
 * affordance for a track.
 *
 * Single-artist tracks render as one inline row inside the parent
 * menu (same UX since this component existed).
 *
 * Multi-artist tracks (Tidal `ArtistRef[]` — feats, collabs, OSTs)
 * render a single "Hide artist ▸" entry instead of one row per
 * credit. Activating it closes the parent popover and opens a
 * dedicated picker popover anchored to the same kebab button so
 * visually the menu content "swaps" in place. Inside the picker the
 * user picks exactly one artist to hide / restore — no
 * "batch-hide everyone" footgun.
 *
 * Used by `TrackKebabMenu`, mini-`Player` and `FullscreenPlayer`,
 * so the multi-artist behaviour stays identical across every kebab
 * surface.
 */
export function ArtistDislikeMenuItems({ track, triggerRef, anchor = 'bottom', align = 'end', onAction }: Props) {
  const t = useT();
  const dislikedArtists = useDislikesStore((s) => s.artists);
  const toggleDislike = useToggleDislike();

  // Prefer the full credit list when the upstream surfaced one;
  // fall back to the legacy artist/artistId pair so older payloads
  // keep working unchanged.
  const artists = useMemo<ArtistRef[]>(() => {
    if (track.artists && track.artists.length > 0) return track.artists;
    if (track.artistId) return [{ id: track.artistId, name: track.artist }];
    return [];
  }, [track.artists, track.artistId, track.artist]);

  // Sub-popover open state for the multi-artist picker. We always
  // declare the hook to keep hook order stable between single- and
  // multi-artist tracks (the artists array can grow at runtime).
  const [pickerOpen, setPickerOpen] = useState(false);
  const fallbackTriggerRef = useRef<HTMLButtonElement | null>(null);
  const subAnchorRef = triggerRef ?? fallbackTriggerRef;

  if (artists.length === 0) return null;

  const fireToggle = (a: ArtistRef) => {
    const wasDisliked = dislikedArtists.has(a.id);
    toggleDislike.mutate(
      {
        kind: 'artist',
        id: a.id,
        source: track.source ?? 'tidal',
        nextState: wasDisliked ? 'unbanned' : 'banned',
      },
      {
        onSuccess: () => {
          toast.info(
            wasDisliked
              ? t('dislike.artistRestored')
              : t('dislike.artistHidden', { name: a.name }),
          );
        },
        onError: (err) => {
          toast.error(err instanceof Error ? err.message : t('dislike.failed'));
        },
      },
    );
  };

  // Single-artist branch: keep the original inline row so the parent
  // menu reads the same as before for the common case.
  if (artists.length === 1) {
    const a = artists[0]!;
    const disliked = dislikedArtists.has(a.id);
    return (
      <MenuItem
        onClick={() => {
          fireToggle(a);
          onAction?.();
        }}
        disabled={toggleDislike.isPending}
        icon={disliked ? <RotateCcw size={14} /> : <Ban size={14} />}
      >
        {disliked
          ? t('dislike.artistUnban', { name: a.name })
          : t('dislike.artistBan', { name: a.name })}
      </MenuItem>
    );
  }

  // Multi-artist branch: a single "Hide artist ▸" trigger that opens
  // the picker popover. The sub-popover is anchored to the parent
  // kebab so the swap reads as one continuous menu, not two stacked
  // popovers.
  const hiddenCount = artists.reduce((acc, a) => acc + (dislikedArtists.has(a.id) ? 1 : 0), 0);

  return (
    <>
      <MenuItem
        ref={fallbackTriggerRef}
        onClick={() => {
          // Fire the parent close synchronously so the sub-popover's
          // outside-click handler doesn't immediately re-trigger from
          // the same pointer event (which would otherwise close the
          // sub-popover the moment it opened).
          onAction?.();
          // requestAnimationFrame defers the open by one frame so the
          // parent has fully unmounted and the trigger ref is stable.
          requestAnimationFrame(() => setPickerOpen(true));
        }}
        icon={<UserMinus size={14} />}
        rightSlot={
          <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
            {hiddenCount > 0 && (
              <span className="rounded-full bg-[var(--color-accent-soft)] px-1.5 py-0.5 font-medium text-[var(--color-accent)]">
                {hiddenCount}
              </span>
            )}
            <ChevronRight size={12} className="text-muted-foreground/70" />
          </span>
        }
      >
        {t('dislike.artistPickerOpen')}
      </MenuItem>

      <PopoverMenu
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        triggerRef={subAnchorRef}
        anchor={anchor}
        align={align}
        width={260}
      >
        <MenuItem
          onClick={() => setPickerOpen(false)}
          icon={<ArrowLeft size={14} />}
          className="text-muted-foreground hover:text-foreground"
        >
          {t('dislike.artistPickerBack')}
        </MenuItem>
        <MenuDivider />
        <div className="px-3 pb-1.5 pt-2 text-[10px] uppercase tracking-wider text-muted-foreground">
          {t('dislike.artistPickerTitle')}
        </div>
        {artists.map((a) => {
          const disliked = dislikedArtists.has(a.id);
          return (
            <MenuItem
              key={a.id}
              onClick={() => {
                fireToggle(a);
                setPickerOpen(false);
              }}
              disabled={toggleDislike.isPending}
              icon={disliked ? <RotateCcw size={14} /> : <Ban size={14} />}
            >
              <span className="flex flex-col items-start">
                <span className="truncate">{a.name}</span>
                {disliked && (
                  <span className="text-[10px] text-muted-foreground">
                    {t('dislike.artistPickerHidden')}
                  </span>
                )}
              </span>
            </MenuItem>
          );
        })}
      </PopoverMenu>
    </>
  );
}
