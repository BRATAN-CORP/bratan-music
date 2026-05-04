import { useMemo } from 'react';
import { Ban, RotateCcw } from 'lucide-react';
import { MenuItem } from '@/components/ui/PopoverMenu';
import type { ArtistRef, Track } from '@/types';
import { useDislikesStore } from '@/store/dislikes';
import { useToggleDislike } from '@/hooks/useDislikes';
import { toast } from '@/store/toast';
import { useT } from '@/i18n';

interface Props {
  track: Track;
  /** Called after a dislike toggle fires — parents use this to close the
   *  hosting popover so the menu collapses on the same tick the toast
   *  appears. */
  onAction?: () => void;
}

/**
 * Shared menu fragment that exposes one toggle row per artist credited
 * on the track. Single-artist tracks render as a single row (same UX
 * as before this component existed); multi-artist tracks fan out into
 * one row per credit so the user can hide / restore each contributor
 * independently — matching the "x, y, u" multi-artist case the user
 * called out.
 *
 * Used by `TrackKebabMenu` (track rows) and the `Player` /
 * `FullscreenPlayer` kebab menus so the multi-artist behaviour is
 * identical everywhere a track exposes one. Caller is responsible for
 * gating on auth + wrapping in the appropriate divider.
 *
 * The component reads the dislikes Set once and computes per-artist
 * status inline; `useDislikesStore` only re-renders when the Set
 * mutates, so a 5-artist track does not pay 5× the selector cost.
 */
export function ArtistDislikeMenuItems({ track, onAction }: Props) {
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

  if (artists.length === 0) return null;

  const handleToggle = (a: ArtistRef) => {
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
    onAction?.();
  };

  return (
    <>
      {artists.map((a) => {
        const disliked = dislikedArtists.has(a.id);
        return (
          <MenuItem
            key={a.id}
            onClick={() => handleToggle(a)}
            disabled={toggleDislike.isPending}
            icon={disliked ? <RotateCcw size={14} /> : <Ban size={14} />}
          >
            {disliked
              ? t('dislike.artistUnban', { name: a.name })
              : t('dislike.artistBan', { name: a.name })}
          </MenuItem>
        );
      })}
    </>
  );
}
