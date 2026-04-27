import { useEffect, useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';

type Anchor = 'top' | 'bottom';
type Align = 'start' | 'end';

interface PopoverMenuProps {
  open: boolean;
  onClose: () => void;
  triggerRef: RefObject<HTMLElement | null>;
  /** Where the menu sits relative to the trigger. 'bottom' = under the trigger
   *  (menu top aligns to trigger bottom), 'top' = above. */
  anchor?: Anchor;
  /** Horizontal alignment to the trigger. 'end' = right edges aligned (default,
   *  matches the previous `right-0` behaviour), 'start' = left edges aligned. */
  align?: Align;
  /** Pixel gap between trigger and menu. Defaults to 8. */
  offset?: number;
  /** Optional fixed width — used to keep the menu from clamping wider than
   *  needed and to right-align before mount. Defaults to 'auto'. */
  width?: number | string;
  className?: string;
  children: ReactNode;
}

/** Floating menu that renders into a body-level portal so it never affects the
 *  layout of the component that owns the trigger. Fixes the "interface stretches
 *  / squeezes when a 3-dots menu opens" bug — previously each dropdown was an
 *  `absolute` child of an inline-flex parent, which in some flex layouts caused
 *  siblings to reflow when the menu mounted. With a portal + fixed positioning
 *  the menu is fully decoupled from its parent's box. */
export function PopoverMenu({
  open,
  onClose,
  triggerRef,
  anchor = 'bottom',
  align = 'end',
  offset = 8,
  width,
  className = '',
  children,
}: PopoverMenuProps) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const update = () => {
      const trigger = triggerRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const menu = menuRef.current;
      const menuW = menu?.offsetWidth ?? (typeof width === 'number' ? width : 0);
      const menuH = menu?.offsetHeight ?? 0;
      let top = anchor === 'bottom' ? rect.bottom + offset : rect.top - menuH - offset;
      let left = align === 'end' ? rect.right - menuW : rect.left;
      // Keep within viewport.
      const margin = 8;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      if (left + menuW > vw - margin) left = vw - margin - menuW;
      if (left < margin) left = margin;
      if (top + menuH > vh - margin) top = vh - margin - menuH;
      if (top < margin) top = margin;
      setPos({ top, left });
    };
    update();
    // Re-run after layout so we have menu dimensions.
    const raf = requestAnimationFrame(update);
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [open, anchor, align, offset, width, triggerRef]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const onPointerDown = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (menuRef.current?.contains(target)) return;
      if (triggerRef.current?.contains(target)) return;
      onClose();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onPointerDown);
    window.addEventListener('touchstart', onPointerDown, { passive: true });
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('touchstart', onPointerDown);
    };
  }, [open, onClose, triggerRef]);

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          ref={menuRef}
          role="menu"
          initial={{ opacity: 0, scale: 0.96, y: anchor === 'bottom' ? -4 : 4 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: anchor === 'bottom' ? -4 : 4 }}
          transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
          style={{
            position: 'fixed',
            top: pos?.top ?? -9999,
            left: pos?.left ?? -9999,
            width,
            visibility: pos ? 'visible' : 'hidden',
            zIndex: 1000,
          }}
          className={'liquid-glass overflow-hidden rounded-[var(--radius-md)] ' + className}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

/** Single row inside a `PopoverMenu`. Centralises the styling for menu rows
 *  so the hover effect, padding, icon spacing and disabled-state look the
 *  same everywhere — previously the mini-player used `hover:bg-secondary`
 *  while the fullscreen 3-dots menu used `hover:bg-white/10`, which
 *  produced two visibly different hovers on the same control. */
type MenuItemProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  /** Optional leading icon. Rendered at 14px to match the existing rows. */
  icon?: ReactNode;
  /** Hide on `md+` widths (used for actions that have a dedicated inline
   *  button on wide screens and only need to be in the kebab on narrow). */
  mobileOnly?: boolean;
};

export function MenuItem({ icon, mobileOnly, className = '', children, type = 'button', ...rest }: MenuItemProps) {
  const visibility = mobileOnly ? ' md:hidden' : '';
  return (
    <button
      type={type}
      role="menuitem"
      {...rest}
      className={
        'popover-menu-item flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors disabled:opacity-60' +
        visibility +
        (className ? ' ' + className : '')
      }
    >
      {icon}
      {children}
    </button>
  );
}

/** Visual divider between groups of `MenuItem`. */
export function MenuDivider({ mobileOnly }: { mobileOnly?: boolean }) {
  return <div className={'h-px bg-[var(--color-border)]' + (mobileOnly ? ' md:hidden' : '')} />;
}
