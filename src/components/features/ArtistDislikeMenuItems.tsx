import { useEffect, useMemo } from 'react';
import { Ban, ChevronRight, RotateCcw, UserMinus } from 'lucide-react';
import { MenuItem } from '@/components/ui/PopoverMenu';
import { ArtistMenuPickerView } from './ArtistMenuPickerView';
import type { ArtistRef, Track } from '@/types';
import { useDislikesStore } from '@/store/dislikes';
import { useToggleDislike } from '@/hooks/useDislikes';
import { toast } from '@/store/toast';
import { useT } from '@/i18n';

/**
 * View token controlled by the parent menu. Switching it swaps the
 * popover's content between the standard track-action list (`'main'`)
 * and the per-credit picker (`'artist-picker'`). The picker reuses the
 * parent popover so position, width, and outside-click handling stay
 * identical between views — this used to be a sub-popover, which made
 * the picker visibly jump on open.
 */
export type ArtistDislikeMenuView = 'main' | 'artist-picker';

interface Props {
  track: Track;
  /**
   * Which slice of the menu this component should render. Owned by the
   * parent so the parent can decide what other rows to render alongside
   * it (the main view shares space with track-action rows; the picker
   * view replaces them).
   */
  view: ArtistDislikeMenuView;
  /**
   * Switches the parent menu between `'main'` and `'artist-picker'`.
   * Required so the multi-artist trigger can drill into the picker
   * and the picker's "Back" row can return.
   */
  onViewChange: (view: ArtistDislikeMenuView) => void;
  /** Called after a dislike toggle fires — the parent uses this to close
   *  the popover so the menu collapses on the same tick the toast appears.
   *  In the picker view it fires once the user has actually picked an
   *  artist (the picker also sets `view` back to `'main'` so a re-open
   *  starts from the standard list). */
  onAction?: () => void;
}

/**
 * Per-track artist hide / restore affordance, shared across every
 * kebab surface (`TrackKebabMenu`, mini-`Player`, `FullscreenPlayer`).
 *
 * Single-artist tracks render a single inline row inside the parent
 * menu — the label is a generic "Скрыть артиста" / "Вернуть
 * артиста", since the parent menu's track context already carries
 * who the artist is.
 *
 * Multi-artist tracks (Tidal `ArtistRef[]` — feats, collabs, OSTs)
 * render a single "Скрыть артиста ▸" entry that swaps the parent
 * menu's content to a per-credit picker. The user picks exactly one
 * artist to hide / restore — no batch-hide-everyone footgun. The
 * picker stays inside the same popover as the main view, so it
 * never visually jumps to a different position when it opens.
 */
export function ArtistDislikeMenuItems({ track, view, onViewChange, onAction }: Props) {
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

  // Guardrail: if the picker view is open but the track has been
  // narrowed down to a single artist (or none) at runtime, fall back
  // to the main view so we don't trap the user on an empty picker.
  // Effect rather than render-time call so we don't synchronously
  // mutate parent state during render.
  useEffect(() => {
    if (view === 'artist-picker' && artists.length <= 1) {
      onViewChange('main');
    }
  }, [view, artists.length, onViewChange]);

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

  // ── Picker view (multi-artist only) ─────────────────────────────
  // Rendered through the shared `ArtistMenuPickerView` so the visual
  // shell (back row, divider, caption, list) stays in lock-step with
  // the "Go to artist" picker (`ArtistGoToMenuItems`). The dislike-
  // specific bits — per-row icon (Ban / RotateCcw) and the "уже
  // скрыт" subtext — are passed in as render hooks.
  if (view === 'artist-picker' && artists.length > 1) {
    return (
      <ArtistMenuPickerView
        artists={artists}
        title={t('dislike.artistPickerTitle')}
        backLabel={t('dislike.artistPickerBack')}
        onBack={() => onViewChange('main')}
        iconFor={(a) => (dislikedArtists.has(a.id) ? <RotateCcw size={14} /> : <Ban size={14} />)}
        subtextFor={(a) =>
          dislikedArtists.has(a.id) ? (
            <span className="text-[10px] text-muted-foreground">
              {t('dislike.artistPickerHidden')}
            </span>
          ) : null
        }
        rowDisabled={() => toggleDislike.isPending}
        onPick={(a) => {
          fireToggle(a);
          onViewChange('main');
          onAction?.();
        }}
      />
    );
  }

  // ── Main view: single-artist branch ─────────────────────────────
  // Generic "Скрыть артиста" copy (no name) — the parent menu already
  // carries the track context, naming the artist again duplicated
  // information and was visibly noisy on long names.
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
        {disliked ? t('dislike.artistUnbanGeneric') : t('dislike.artistBanGeneric')}
      </MenuItem>
    );
  }

  // ── Main view: multi-artist branch ──────────────────────────────
  // Single trigger that drills into the picker. Hidden-count badge
  // mirrors the same affordance as the picker so the user can see at a
  // glance how many credits are already on their banned list without
  // opening the picker.
  const hiddenCount = artists.reduce((acc, a) => acc + (dislikedArtists.has(a.id) ? 1 : 0), 0);
  return (
    <MenuItem
      onClick={() => onViewChange('artist-picker')}
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
  );
}
