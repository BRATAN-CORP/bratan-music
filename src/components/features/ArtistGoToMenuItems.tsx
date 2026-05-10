import { useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight, User as UserIcon } from 'lucide-react';
import { MenuItem } from '@/components/ui/PopoverMenu';
import { ArtistMenuPickerView } from './ArtistMenuPickerView';
import type { ArtistRef, Track } from '@/types';
import { useT } from '@/i18n';

/**
 * View token controlled by the parent menu. Switching between
 * `'main'` and `'artist-go-picker'` swaps the popover's content
 * between the standard track-action list (`'main'`) and the
 * per-credit picker that lets the user pick which artist to navigate
 * to (`'artist-go-picker'`).
 *
 * Mirrors `ArtistDislikeMenuView` so multi-credit "Go to artist" and
 * multi-credit "Hide artist" feel symmetric to the user — both drill
 * into a picker inside the same popover and return via a "← Back"
 * row.
 */
export type ArtistGoToMenuView = 'main' | 'artist-go-picker';

interface Props {
  track: Track;
  view: ArtistGoToMenuView;
  onViewChange: (view: ArtistGoToMenuView) => void;
  /** Closes the parent popover after the user picks an artist or
   *  fires the direct single-artist navigation. */
  onAction?: () => void;
  /** Hook called immediately before `navigate(...)` runs — used by
   *  the FullscreenPlayer to dismiss its overlay so the artist page
   *  is visible during the transition. */
  beforeNavigate?: () => void;
}

/**
 * Per-track "Go to artist" affordance, shared across every kebab
 * surface (`TrackKebabMenu`, mini-`Player`, `FullscreenPlayer`).
 *
 * Single-artist tracks render a direct row that navigates straight
 * to the artist page — same UX as before this component existed.
 *
 * Multi-artist tracks (Tidal `ArtistRef[]` — feats, collabs, OSTs)
 * render a single "Перейти к артисту ▸" entry that swaps the parent
 * menu's content to a per-credit picker. The user picks exactly one
 * artist to navigate to. The picker stays inside the same popover
 * as the main view, so it never visually jumps to a different
 * position when it opens — same pattern as the artist-hide picker
 * (see `ArtistDislikeMenuItems`).
 */
export function ArtistGoToMenuItems({ track, view, onViewChange, onAction, beforeNavigate }: Props) {
  const t = useT();
  const navigate = useNavigate();

  // Prefer the full credit list when the upstream surfaced one; fall
  // back to the legacy artist/artistId pair so older payloads keep
  // working unchanged.
  const artists = useMemo<ArtistRef[]>(() => {
    if (track.artists && track.artists.length > 0) return track.artists;
    if (track.artistId) return [{ id: track.artistId, name: track.artist }];
    return [];
  }, [track.artists, track.artistId, track.artist]);

  // Guardrail: if the picker view is open but the track has been
  // narrowed to a single artist (or none) at runtime, fall back to
  // the main view so we don't trap the user on an empty picker.
  useEffect(() => {
    if (view === 'artist-go-picker' && artists.length <= 1) {
      onViewChange('main');
    }
  }, [view, artists.length, onViewChange]);

  if (artists.length === 0) return null;

  const goTo = (a: ArtistRef) => {
    if (!a.id) return;
    beforeNavigate?.();
    navigate(`/artist/${a.id}`);
  };

  // ── Picker view (multi-artist only) ─────────────────────────────
  if (view === 'artist-go-picker' && artists.length > 1) {
    return (
      <ArtistMenuPickerView
        artists={artists}
        title={t('track.goToArtistPickerTitle')}
        backLabel={t('track.goToArtistPickerBack')}
        onBack={() => onViewChange('main')}
        onPick={(a) => {
          goTo(a);
          onViewChange('main');
          onAction?.();
        }}
      />
    );
  }

  // ── Main view: single-artist branch — direct navigate ──────────
  if (artists.length === 1) {
    const a = artists[0]!;
    return (
      <MenuItem
        onClick={() => {
          goTo(a);
          onAction?.();
        }}
        icon={<UserIcon size={14} />}
      >
        {t('track.goToArtist')}
      </MenuItem>
    );
  }

  // ── Main view: multi-artist trigger ────────────────────────────
  return (
    <MenuItem
      onClick={() => onViewChange('artist-go-picker')}
      icon={<UserIcon size={14} />}
      rightSlot={<ChevronRight size={12} className="text-muted-foreground/70" />}
    >
      {t('track.goToArtist')}
    </MenuItem>
  );
}
