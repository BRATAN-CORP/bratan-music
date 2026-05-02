import { Link, useLocation } from 'react-router-dom';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import { Headphones } from 'lucide-react';
import { useState } from 'react';
import { useRoomConnectionStore } from '@/store/roomConnection';
import { EASE_SPRING } from '@/lib/motion';
import { useT } from '@/i18n';

/**
 * Floating "you're connected to a room" pill, anchored to the
 * top-right corner of the viewport. Mounted once at the layout level
 * so the indicator persists while the user navigates around the app —
 * it disappears only when the user leaves the room (via Выйти / Удалить
 * on the room page) or refreshes the tab.
 *
 * Visual language:
 *   - Compact circular icon button with a soft accent glow + ping
 *     ring. Reads as "live / connected" without any text on mobile.
 *   - On desktop, hovering the button expands it horizontally to
 *     reveal the room name. Tapping anywhere on the badge routes
 *     back to `/rooms/:id`.
 *   - Hidden on the room page itself — the giant in-page header
 *     already conveys the same info there, the badge would just be
 *     visual noise.
 */
export function RoomConnectedBadge() {
  const reduce = useReducedMotion();
  const { roomId, roomCode, roomName, isLive } = useRoomConnectionStore();
  const location = useLocation();
  const [hovered, setHovered] = useState(false);
  const t = useT();

  const onRoomPage = !!roomId && location.pathname.startsWith(`/rooms/${roomId}`);
  const visible = !!roomId && !onRoomPage;
  const label = roomName?.trim() || roomCode || t('rooms.connectedFallback');

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key={roomId}
          initial={reduce ? false : { opacity: 0, y: -12, scale: 0.9 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={reduce ? undefined : { opacity: 0, y: -12, scale: 0.9 }}
          transition={{ duration: 0.32, ease: EASE_SPRING }}
          className="fixed right-3 z-40 sm:right-6"
          // Sit just below the safe-area inset on iOS notches and
          // give a little breathing room on Android / desktop too.
          style={{ top: 'calc(env(safe-area-inset-top, 0px) + 0.75rem)' }}
        >
          <Link
            to={`/rooms/${roomId}`}
            aria-label={t('rooms.connectedAriaLabel', { name: label })}
            title={t('rooms.connectedTooltip', { name: label })}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            onFocus={() => setHovered(true)}
            onBlur={() => setHovered(false)}
            className="group relative inline-flex h-10 items-center overflow-hidden rounded-full border border-[var(--color-accent)]/40 bg-card/90 pl-1 pr-1 shadow-[var(--shadow-md)] backdrop-blur transition-colors hover:border-[var(--color-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]/60 sm:h-11"
          >
            {/* Halo behind the icon — softly pulses when the bridge
                is live, sits idle otherwise. Sits behind everything
                via negative z. */}
            {!reduce && isLive && (
              <span
                aria-hidden
                className="absolute left-1 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 animate-ping rounded-full bg-[var(--color-accent)]/30 sm:h-9 sm:w-9"
              />
            )}
            <span
              aria-hidden
              className="relative z-[1] inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--color-accent)] text-white shadow-[0_0_0_1px_var(--color-accent)] sm:h-9 sm:w-9"
            >
              <Headphones size={15} strokeWidth={2.25} />
            </span>

            {/* Expanding label. On hover/focus we animate the width
                so the badge reads as a tidy circle at rest and a
                full pill when interacting. Hidden on touch — there
                we just route on tap so the icon stays compact. */}
            <motion.span
              animate={{
                width: hovered ? 'auto' : 0,
                opacity: hovered ? 1 : 0,
                marginLeft: hovered ? 8 : 0,
                marginRight: hovered ? 10 : 0,
              }}
              transition={{ type: 'spring', stiffness: 360, damping: 32 }}
              className="hidden whitespace-nowrap text-xs font-medium text-foreground sm:inline-block"
              style={{ overflow: 'hidden' }}
            >
              <span className="text-muted-foreground">{t('rooms.connectedPrefix')}</span>
              <span className="text-foreground">{label}</span>
            </motion.span>
          </Link>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
