import { type ComponentProps } from 'react';
import { Modal } from '@/components/ui/Modal';

type SheetProps = Omit<ComponentProps<typeof Modal>, 'align'>;

/**
 * Bottom-sheet wrapper around `<Modal>`. Identical in behaviour, but
 * defaults `align="sheet"` so the panel anchors to the bottom of the
 * viewport on mobile (clearing safe-area + the persistent player + the
 * mobile bottom dock) and centres on `sm:` and above.
 *
 * Use for dialogs whose primary surface is a list of choices the user
 * scans top-to-bottom (add-to-playlist, queue, share-management) —
 * those read more naturally as a sheet on touch devices.
 */
export function Sheet(props: SheetProps) {
  return <Modal align="sheet" {...props} />;
}
