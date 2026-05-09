import { useRef, useState, type ReactNode } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { IconButton } from '@/components/ui/IconButton';
import { PopoverMenu } from '@/components/ui/PopoverMenu';
import { useT } from '@/i18n';

interface HeroActionsKebabProps {
  /** Menu rows. Caller composes `MenuItem` / `MenuDivider` here. */
  children: ReactNode;
  /** Tailwind classes on the trigger — typically a responsive
   *  visibility helper (`sm:hidden`, `md:hidden`) so the kebab only
   *  renders on viewport widths where the inline action rail no
   *  longer fits. */
  className?: string;
  /** Pixel width of the popover. Defaults to 224 to match the
   *  per-track kebab so labels never truncate the way they would on a
   *  narrower menu. */
  width?: number;
}

/**
 * Dedicated overflow-kebab for `PageHero` action rows on
 * artist / album / playlist detail pages.
 *
 * The hero used to render every secondary affordance (radio, share,
 * dislike, …) as an inline icon button next to the primary "Listen"
 * CTA. On narrow viewports those wrapped onto a second line, which
 * misread as "broken layout" — the user explicitly flagged this. We
 * now keep the primary CTA + a couple of high-value icon buttons
 * inline, and fold the rest into this kebab on `< sm` widths so the
 * action rail stays a single row.
 *
 * The trigger reuses the standard `IconButton` styling so the kebab
 * visually matches the inline icons it replaces; the popover is the
 * same `PopoverMenu` body that powers `TrackKebabMenu`, so menu rows
 * keep their familiar look (icon + label + optional right slot, body-
 * portal positioning, outside-click dismissal).
 */
export function HeroActionsKebab({
  children,
  className,
  width = 224,
}: HeroActionsKebabProps) {
  const t = useT();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);

  return (
    <>
      <IconButton
        ref={triggerRef}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        aria-label={t('hero.moreActions')}
        aria-haspopup="menu"
        aria-expanded={open}
        className={className}
      >
        <MoreHorizontal size={16} />
      </IconButton>
      <PopoverMenu
        open={open}
        onClose={() => setOpen(false)}
        triggerRef={triggerRef}
        anchor="bottom"
        align="end"
        width={width}
      >
        {children}
      </PopoverMenu>
    </>
  );
}
