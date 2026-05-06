/**
 * Slim "Вы офлайн" banner that drops in from the top of the screen
 * whenever `navigator.onLine` flips to false. Disappears with a quick
 * spring as soon as connectivity returns.
 *
 * Sits at the very top of the app shell so every page sees it. We
 * deliberately keep it short and accent-coloured rather than
 * dismissible — the user needs to know that they're working from the
 * cached library only.
 */
import { motion, AnimatePresence } from 'motion/react';
import { WifiOff } from 'lucide-react';
import { useOnline } from '@/hooks/useOnline';
import { useT } from '@/i18n';

export function OfflineBanner() {
  const t = useT();
  const online = useOnline();

  return (
    <AnimatePresence>
      {!online && (
        <motion.div
          key="offline-banner"
          role="status"
          aria-live="polite"
          initial={{ y: -40, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -40, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 360, damping: 26 }}
          className="sticky top-0 z-50 flex items-center justify-center gap-2 border-b border-[var(--color-accent)]/30 bg-[var(--color-accent)]/15 px-4 py-2 text-xs font-medium text-[var(--color-accent)] backdrop-blur"
        >
          <WifiOff size={14} />
          <span>{t('offline.bannerOffline')}</span>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
