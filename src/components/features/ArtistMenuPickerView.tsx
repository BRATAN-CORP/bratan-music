import { ArrowLeft, ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { MenuDivider, MenuItem } from '@/components/ui/PopoverMenu';
import type { ArtistRef } from '@/types';

/**
 * Per-credit picker view shared between every per-artist track action
 * that needs to disambiguate which artist a multi-credit track is
 * being acted on (`ArtistDislikeMenuItems`, `ArtistGoToMenuItems`,
 * future "share artist", "start artist radio", etc.).
 *
 * Visually:
 *
 *   [← Back]
 *   ────────────────
 *   PICKER TITLE
 *   [icon] Artist 1   [optional right slot]
 *   [icon] Artist 2
 *   …
 *
 * The component is intentionally view-only — it owns no state and
 * fires `onPick` / `onBack` for the parent to drive. Parents control
 * which view is rendered (main / picker) by toggling their own
 * `menuView` token, so the picker stays inside the same popover as
 * the main list and never visibly jumps to a new position when it
 * opens.
 */
interface Props {
  artists: ArtistRef[];
  /** Caption shown above the artist rows. */
  title: string;
  /** Label for the back row that returns to the main view. */
  backLabel: string;
  onBack: () => void;
  onPick: (artist: ArtistRef) => void;
  /** Per-row leading icon. Defaults to a chevron-right glyph if
   *  omitted (matches the "navigate / drill-in" semantic). */
  iconFor?: (artist: ArtistRef) => ReactNode;
  /** Optional small line beneath the artist name (e.g. "Already
   *  hidden"). */
  subtextFor?: (artist: ArtistRef) => ReactNode | null;
  /** Per-row disabled flag — used during in-flight mutations so the
   *  user can't double-click. */
  rowDisabled?: (artist: ArtistRef) => boolean;
}

export function ArtistMenuPickerView({
  artists,
  title,
  backLabel,
  onBack,
  onPick,
  iconFor,
  subtextFor,
  rowDisabled,
}: Props) {
  return (
    <>
      <MenuItem
        onClick={onBack}
        icon={<ArrowLeft size={14} />}
        className="text-muted-foreground hover:text-foreground"
      >
        {backLabel}
      </MenuItem>
      <MenuDivider />
      <div className="px-3 pb-1.5 pt-2 text-[10px] uppercase tracking-wider text-muted-foreground">
        {title}
      </div>
      {artists.map((a) => (
        <MenuItem
          key={a.id}
          onClick={() => onPick(a)}
          icon={iconFor ? iconFor(a) : <ChevronRight size={14} />}
          disabled={rowDisabled?.(a)}
        >
          <span className="flex flex-col items-start">
            <span className="truncate">{a.name}</span>
            {subtextFor?.(a)}
          </span>
        </MenuItem>
      ))}
    </>
  );
}
