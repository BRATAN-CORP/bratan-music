import { type ReactNode, useId, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import { useEscapeClose } from '@/hooks/useEscapeClose';

type ModalLayer = 'default' | 'elevated' | 'confirm';
type ModalAlign = 'center' | 'sheet';
type ModalSize = 'sm' | 'md' | 'lg' | 'xl';

interface ModalProps {
  /** Controls visibility. Internally driven by `AnimatePresence` so the
   *  exit animation plays after `open` flips to false. */
  open: boolean;
  /** Called when the user dismisses the dialog (Esc, backdrop click,
   *  explicit close button). The component does not flip `open` itself. */
  onClose: () => void;

  /** Stacking layer. `default` (60) covers the vast majority of dialogs;
   *  `elevated` (70) is for modals that may open ON TOP of another
   *  modal (admin nested detail). `confirm` (90) is reserved for
   *  destructive-confirm sheets that must paint above toasts. */
  layer?: ModalLayer;
  /** `center` is a centred dialog at every breakpoint. `sheet` keeps
   *  centred on `sm:` and above but anchors to the bottom of the
   *  viewport on mobile (with safe-area + player + dock clearance). */
  align?: ModalAlign;
  /** Default panel `max-width`. Overridable via `panelClassName`. */
  size?: ModalSize;

  /** When true (default) backdrop click and Esc close the dialog. */
  dismissible?: boolean;
  /** When true, ignores backdrop / Esc requests but stays mounted. Use
   *  for the brief async window between confirm-click and the parent's
   *  IDB writes settling, so a panicky double-tap doesn't fire the
   *  destructive action twice. */
  busy?: boolean;

  /** ARIA: id of the heading element rendered inside `children`. */
  labelledBy?: string;
  /** ARIA: id of the descriptive paragraph rendered inside `children`. */
  describedBy?: string;
  /** ARIA: explicit label when no visible heading is rendered. */
  ariaLabel?: string;

  /** Extra classes on the panel surface. Use to pin width / padding /
   *  internal layout for a specific dialog. The default `liquid-glass`
   *  surface + rounded corners + reasonable max-width are already
   *  applied — consumers usually only add padding and width tweaks. */
  panelClassName?: string;
  /** Extra classes on the scrim layer. */
  scrimClassName?: string;

  children: ReactNode;
}

const layerClass: Record<ModalLayer, string> = {
  default: 'z-[60]',
  elevated: 'z-[70]',
  confirm: 'z-[90]',
};

const sizeClass: Record<ModalSize, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-xl',
};

/**
 * Unified modal primitive. Replaces the open-coded
 * `liquid-glass-scrim + AnimatePresence + motion.div` recipe that lives
 * in every feature dialog today.
 *
 * Owns:
 *   - body portal (so the scrim escapes any parent stacking context;
 *     fixes the dialog-pinned-behind-mini-player class of bugs)
 *   - body scroll lock (counter-based so stacked dialogs are safe)
 *   - Esc and backdrop dismissal, with a `busy` gate
 *   - reduced-motion-friendly enter / exit animations
 *   - `role="dialog"` + `aria-modal="true"` defaults
 *
 * Does NOT own header / footer / body composition — every dialog has
 * its own internal layout. Compose your own, optionally using the
 * `<ModalHeader>` and `<ModalCloseButton>` helpers below.
 */
export function Modal({
  open,
  onClose,
  layer = 'default',
  align = 'center',
  size = 'sm',
  dismissible = true,
  busy = false,
  labelledBy,
  describedBy,
  ariaLabel,
  panelClassName,
  scrimClassName,
  children,
}: ModalProps) {
  // Hold the lock while the dialog is open. The hook's process-wide
  // counter guarantees stacked dialogs don't release the body lock
  // until the last one closes.
  useBodyScrollLock(open);
  useEscapeClose(open, onClose, dismissible && !busy);

  const handleBackdropClick = useMemo(
    () => () => {
      if (!dismissible || busy) return;
      onClose();
    },
    [dismissible, busy, onClose],
  );

  if (typeof document === 'undefined') return null;

  const node = (
    <AnimatePresence>
      {open && (
        <div className={cn('fixed inset-0', layerClass[layer])} role="presentation">
          <motion.div
            key="modal-scrim"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            onClick={handleBackdropClick}
            className={cn(
              'liquid-glass-scrim absolute inset-0',
              scrimClassName,
            )}
            aria-hidden
          />
          <div
            className={cn(
              'pointer-events-none absolute inset-0 flex flex-col items-center px-4',
              align === 'sheet'
                ? 'justify-end pb-[calc(var(--pwa-safe-bottom)+5rem)] sm:justify-center sm:pb-0'
                : 'justify-center',
            )}
          >
            <motion.div
              key="modal-panel"
              role="dialog"
              aria-modal="true"
              aria-labelledby={labelledBy}
              aria-describedby={describedBy}
              aria-label={!labelledBy ? ariaLabel : undefined}
              initial={
                align === 'sheet'
                  ? { opacity: 0, y: 32, scale: 0.97 }
                  : { opacity: 0, y: 12, scale: 0.96 }
              }
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={
                align === 'sheet'
                  ? { opacity: 0, y: 24, scale: 0.97 }
                  : { opacity: 0, y: 8, scale: 0.96 }
              }
              transition={{ type: 'spring', stiffness: 380, damping: 32 }}
              onClick={(e) => e.stopPropagation()}
              className={cn(
                'liquid-glass pointer-events-auto w-full overflow-hidden rounded-[var(--radius-lg)]',
                sizeClass[size],
                panelClassName,
              )}
            >
              {children}
            </motion.div>
          </div>
        </div>
      )}
    </AnimatePresence>
  );

  return createPortal(node, document.body);
}

interface ModalHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  onClose?: () => void;
  closeAriaLabel?: string;
  /** Marks the visible heading id, so `<Modal labelledBy={...} />` can
   *  bind aria-labelledby to it. Falls back to a generated id. */
  titleId?: string;
  /** Same idea for the description paragraph (aria-describedby). */
  descriptionId?: string;
  className?: string;
}

/**
 * Standard dialog header. Most dialogs need exactly this layout: title +
 * optional description on the left, close button on the right.
 */
export function ModalHeader({
  title,
  description,
  onClose,
  closeAriaLabel,
  titleId,
  descriptionId,
  className,
}: ModalHeaderProps) {
  const generatedTitleId = useId();
  const id = titleId ?? generatedTitleId;
  return (
    <div className={cn('flex items-start justify-between gap-3', className)}>
      <div className="min-w-0">
        <h2 id={id} className="text-base font-semibold tracking-tight">
          {title}
        </h2>
        {description ? (
          <p id={descriptionId} className="mt-1 line-clamp-2 text-xs text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      {onClose ? (
        <ModalCloseButton onClose={onClose} ariaLabel={closeAriaLabel} />
      ) : null}
    </div>
  );
}

interface ModalCloseButtonProps {
  onClose: () => void;
  ariaLabel?: string;
  className?: string;
  disabled?: boolean;
}

/**
 * Standalone close (X) button. Lifted into a component so every dialog
 * gets the same hit-area, focus ring and disabled-during-busy
 * affordance.
 */
export function ModalCloseButton({
  onClose,
  ariaLabel = 'Close',
  className,
  disabled,
}: ModalCloseButtonProps) {
  return (
    <button
      type="button"
      onClick={onClose}
      disabled={disabled}
      aria-label={ariaLabel}
      className={cn(
        '-mr-1 -mt-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-[var(--color-hover-overlay)] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-40',
        className,
      )}
    >
      <X size={16} />
    </button>
  );
}
